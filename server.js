const express = require('express');
const sql = require('mssql');
const session = require('express-session');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

// --- Load config ---
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch {
  console.warn('config.json not found or invalid, using env vars / defaults');
}

const connStr = process.env.DB_CONNECTION_STRING || config.connectionString || '';
const adminPassword = config.adminPassword || '';
const smtpConfig = config.smtp || {};
const githubConfig = config.github || {
  token: process.env.GITHUB_TOKEN || '',
  owner: process.env.GITHUB_OWNER || 'surendiransithamparam',
  repo: process.env.GITHUB_REPO || 'HaushaltPLUS'
};

// WebAuthn / FIDO2 Konfiguration
const webauthnConfigStatic = {
  rpID: process.env.WEBAUTHN_RP_ID || (config.webauthn && config.webauthn.rpId) || null,
  rpName: process.env.WEBAUTHN_RP_NAME || (config.webauthn && config.webauthn.rpName) || 'Einkaufsliste',
  origin: process.env.WEBAUTHN_ORIGIN || (config.webauthn && config.webauthn.origin) || null
};

// Dynamisch RP ID und Origin aus Request ableiten, falls nicht explizit konfiguriert
function getWebauthnConfig(req) {
  const host = req.hostname || req.headers.host?.split(':')[0] || 'localhost';
  const protocol = req.protocol || (req.secure ? 'https' : 'http');
  const port = req.headers.host?.includes(':') ? ':' + req.headers.host.split(':')[1] : '';
  return {
    rpID: webauthnConfigStatic.rpID || host,
    rpName: webauthnConfigStatic.rpName,
    origin: webauthnConfigStatic.origin || `${protocol}://${host}${port}`
  };
}

// --- SQL pool ---
let pool;
async function getPool() {
  if (pool) return pool;
  pool = await sql.connect(connStr);
  return pool;
}

// --- Rate Limiting (in-memory) ---
const rateLimitStore = new Map();

function isRateLimited(req, prefix, maxRequests = 10, windowSeconds = 60) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const key = `${prefix}:${ip}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || entry.window < now) {
    rateLimitStore.set(key, { count: 1, window: now + windowSeconds * 1000 });
    return false;
  }
  entry.count++;
  return entry.count > maxRequests;
}

// --- Password Helpers ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `${salt.toString('base64')}.${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = stored.split('.');
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], 'base64');
  const expectedHash = Buffer.from(parts[1], 'base64');
  const actualHash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

// --- Code Generator ---
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[crypto.randomInt(chars.length)];
  }
  return result;
}

// --- DB Helpers ---
async function getHaushaltId(userId, pool) {
  const result = await pool.request()
    .input('uid', sql.Int, userId)
    .query('SELECT HaushaltId FROM Benutzer WHERE Id=@uid');
  const row = result.recordset[0];
  return row && row.HaushaltId != null ? row.HaushaltId : null;
}

async function getHaushaltRolle(userId, pool) {
  const result = await pool.request()
    .input('uid', sql.Int, userId)
    .query('SELECT HaushaltRolle FROM Benutzer WHERE Id=@uid');
  const row = result.recordset[0];
  return row && row.HaushaltRolle ? row.HaushaltRolle : 'schreibend';
}

async function canWrite(userId, pool) {
  const rolle = await getHaushaltRolle(userId, pool);
  return rolle !== 'lesend';
}

async function isAdmin(userId, pool) {
  const result = await pool.request()
    .input('uid', sql.Int, userId)
    .query('SELECT IsAdmin FROM Benutzer WHERE Id=@uid');
  const row = result.recordset[0];
  return row && row.IsAdmin === true;
}

// --- Email Helper ---
async function sendActivationEmail(email, username, token, req) {
  const host = smtpConfig.host || '';
  const port = smtpConfig.port || 587;
  const user = smtpConfig.user || '';
  const pass = smtpConfig.password || '';
  const fromAddr = smtpConfig.from || user;
  const fromName = smtpConfig.fromName || 'HaushaltPLUS';

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const link = `${baseUrl}/api/auth/aktivieren?token=${encodeURIComponent(token)}`;

  const body = `Hallo ${username},

Bitte bestätige deine E-Mail-Adresse, indem du auf folgenden Link klickst:

${link}

Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren.

Viele Grüsse
HaushaltPLUS`;

  const transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: `"${fromName}" <${fromAddr}>`,
    to: email,
    subject: 'HaushaltPLUS – E-Mail bestätigen',
    text: body
  });
}

// --- Auth Middleware ---
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({});
  }
  next();
}

// --- Delete household cascade helper ---
async function deleteHaushaltCascade(hid, db) {
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Wochenplan WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM GerichtZutat WHERE GerichtId IN (SELECT Id FROM Gericht WHERE HaushaltId=@hid)');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Gericht WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('UPDATE Artikel SET HaushaltId=NULL WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Favorit WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Haushalt WHERE Id=@hid');
}

// --- Recipe Parsers ---
const allowedRecipeHosts = new Set([
  'www.bettybossi.ch', 'bettybossi.ch',
  'migusto.migros.ch',
  'fooby.ch', 'www.fooby.ch',
  'www.chefkoch.de', 'chefkoch.de',
  'www.swissmilk.ch', 'swissmilk.ch',
  'www.gutekueche.ch', 'gutekueche.ch',
  'www.vegrecipesofindia.com', 'vegrecipesofindia.com',
  'www.indianhealthyrecipes.com', 'indianhealthyrecipes.com',
  'cookwithpranji.com', 'www.cookwithpranji.com',
  'www.padhuskitchen.com', 'padhuskitchen.com',
  'hebbarskitchen.com', 'www.hebbarskitchen.com'
]);

function toTitleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

function parseBettyBossi(html) {
  const results = [];
  const linkPattern = /href="(\/de\/rezepte\/rezept\/[^"]+\/)"/gi;
  const seen = new Set();
  let m;
  while ((m = linkPattern.exec(html)) !== null) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    const slug = p.split('/').filter(s => s).pop() || '';
    let nameParts = slug.split('-');
    if (nameParts.length > 1 && /^\d+$/.test(nameParts[nameParts.length - 1])) {
      nameParts = nameParts.slice(0, -1);
    }
    let name = nameParts.join(' ').replace(/ae/g, 'ä').replace(/ue/g, 'ü').replace(/oe/g, 'ö');
    name = toTitleCase(name);
    results.push({ url: 'https://www.bettybossi.ch' + p, name, source: 'Betty Bossi' });
    if (results.length >= 5) break;
  }
  return results;
}

function parseJsonLdRecipes(html, baseUrl) {
  const results = [];
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;
  const linkPattern = /href="((?:\/[^"]*?)?\/rezept[^"]*?)"[^>]*>/gi;
  const hostName = new URL(baseUrl).host.replace('www.', '');

  let jm;
  while ((jm = jsonLdPattern.exec(html)) !== null) {
    try {
      const doc = JSON.parse(jm[1]);
      if (doc.itemListElement) {
        for (const item of doc.itemListElement) {
          let url = item.url || null;
          const name = item.name || null;
          if (url && name) {
            if (!url.startsWith('http')) url = baseUrl + url;
            results.push({ url, name, source: hostName });
          }
          if (results.length >= 5) return results;
        }
      }
      if (doc['@type'] === 'Recipe') {
        const url = doc.url || null;
        const name = doc.name || null;
        if (url && name) results.push({ url, name, source: hostName });
      }
    } catch {}
  }

  if (results.length === 0) {
    const seen = new Set();
    let lm;
    while ((lm = linkPattern.exec(html)) !== null) {
      const p = lm[1];
      if (seen.has(p)) continue;
      seen.add(p);
      const fullUrl = p.startsWith('http') ? p : baseUrl + p;
      const slug = p.split('/').filter(s => s).pop() || '';
      let name = slug.replace(/-/g, ' ');
      name = toTitleCase(name);
      if (name.length > 2) results.push({ url: fullUrl, name, source: hostName });
      if (results.length >= 5) break;
    }
  }
  return results;
}

function parseChefkoch(html) {
  const results = [];
  const pattern = /href="(https:\/\/www\.chefkoch\.de\/rezepte\/\d+\/[^"]+)"/gi;
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;

  let jm;
  while ((jm = jsonLdPattern.exec(html)) !== null) {
    try {
      const doc = JSON.parse(jm[1]);
      if (doc.itemListElement) {
        for (const item of doc.itemListElement) {
          const itemObj = item.item || item;
          const url = itemObj.url || null;
          const name = itemObj.name || null;
          if (url && name) results.push({ url, name, source: 'Chefkoch' });
          if (results.length >= 5) return results;
        }
      }
    } catch {}
  }

  if (results.length === 0) {
    const seen = new Set();
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const url = m[1];
      if (seen.has(url)) continue;
      seen.add(url);
      const slug = (url.split('/').pop() || '').replace('.html', '');
      let name = slug.replace(/-/g, ' ').replace(/_/g, ' ');
      name = toTitleCase(name);
      results.push({ url, name, source: 'Chefkoch' });
      if (results.length >= 5) break;
    }
  }
  return results;
}

function parseGuteKueche(html) {
  const results = [];
  const pattern = /href="(https:\/\/www\.gutekueche\.ch\/[^"]*-rezept-\d+)"/gi;
  const seen = new Set();
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    let slug = (url.split('/').pop() || '');
    slug = slug.replace(/-rezept-\d+$/, '');
    let name = slug.replace(/-/g, ' ');
    name = toTitleCase(name);
    results.push({ url, name, source: 'GuteKüche' });
    if (results.length >= 5) break;
  }
  return results;
}

function parseGenericRecipeLinks(html, baseUrl, sourceName) {
  const results = [];
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;

  let jm;
  while ((jm = jsonLdPattern.exec(html)) !== null) {
    try {
      const doc = JSON.parse(jm[1]);

      // Handle @graph arrays
      if (doc['@graph']) {
        for (const node of doc['@graph']) {
          const t = (node['@type'] || '').toString();
          if (t.includes('Recipe')) {
            const url = node.url || null;
            const name = node.name || null;
            if (url && name) results.push({ url, name, source: sourceName });
            if (results.length >= 5) return results;
          }
        }
        if (results.length > 0) continue;
      }

      // ItemList
      if (doc.itemListElement) {
        for (const item of doc.itemListElement) {
          const itemObj = item.item || item;
          const url = itemObj.url || null;
          const name = itemObj.name || null;
          if (url && name) results.push({ url, name, source: sourceName });
          if (results.length >= 5) return results;
        }
        if (results.length > 0) continue;
      }

      // Single Recipe
      const typeStr = (doc['@type'] || '').toString();
      if (typeStr.includes('Recipe')) {
        const url = doc.url || null;
        const name = doc.name || null;
        if (url && name) results.push({ url, name, source: sourceName });
        continue;
      }

      // Array of objects at root
      if (Array.isArray(doc)) {
        for (const el of doc) {
          const t = (el['@type'] || '').toString();
          if (t.includes('Recipe')) {
            const url = el.url || null;
            const name = el.name || null;
            if (url && name) results.push({ url, name, source: sourceName });
            if (results.length >= 5) return results;
          }
        }
      }
    } catch {}
  }

  // Fallback: parse <a> tags (WordPress pattern)
  if (results.length === 0) {
    const escapedBase = baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkPattern = new RegExp(
      '<a[^>]+href="(' + escapedBase + '/[^"]+)"[^>]*>\\s*(?:<[^>]+>)*\\s*([^<]{3,80}?)\\s*(?:</[^>]+>)*\\s*</a>',
      'gi'
    );
    const seen = new Set();
    const skipSegments = ['/category/', '/tag/', '/author/', '/page/', '#', '/feed/',
      '/recipes/', '/recipe-index', '/cooking-recipes', '/useful-tips', '/testimonial',
      '/contact', '/about', '/privacy', '/disclaimer'];
    let lm;
    while ((lm = linkPattern.exec(html)) !== null) {
      const url = lm[1];
      if (skipSegments.some(s => url.includes(s))) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      let name = decodeHTMLEntities(lm[2]).trim();
      if (name.length < 3 || name.length > 80) continue;
      if (!name.includes(' ') && name.length < 15) continue;
      if (['Read', 'Continue'].some(s => name.startsWith(s)) ||
          ['Home', 'Search', 'ABOUT', 'RECIPE INDEX', 'USEFUL TIPS', 'TESTIMONIALS'].includes(name)) continue;
      results.push({ url, name, source: sourceName });
      if (results.length >= 5) break;
    }
  }

  // Fallback 2: <h2>/<h3> with links
  if (results.length === 0) {
    const headingLinkPattern = /<h[23][^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>\s*([^<]{3,80}?)\s*<\/a>/gi;
    const seen = new Set();
    let hm;
    while ((hm = headingLinkPattern.exec(html)) !== null) {
      let url = hm[1];
      if (!url.startsWith('http')) url = baseUrl + url;
      if (!url.startsWith(baseUrl)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const name = decodeHTMLEntities(hm[2]).trim();
      if (name.length < 3) continue;
      results.push({ url, name, source: sourceName });
      if (results.length >= 5) break;
    }
  }

  return results;
}

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function parseZutat(text, list) {
  const m = text.match(/^(\d+[.,/]?\d*)\s*(g|kg|ml|dl|l|EL|TL|Stück|Prise|Bund|Packung|Pack\.|Beutel|Dose|Becher|Scheibe|Scheiben|Blatt|Blätter|Zweiglein)?\s*(.+)$/i);
  if (m) {
    let mengeStr = m[1].replace(',', '.');
    if (mengeStr.includes('/')) {
      const frac = mengeStr.split('/');
      mengeStr = (parseFloat(frac[0]) / parseFloat(frac[1])).toString();
    }
    const menge = parseFloat(mengeStr) || 1;
    const einheit = m[2] || 'Stück';
    const artikel = m[3].trim().replace(/[,.]$/, '');
    list.push({ menge, einheit, artikel });
  } else {
    list.push({ menge: 1, einheit: 'Stück', artikel: text.trim() });
  }
}

// --- Express App ---
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use(session({
  name: 'einkauf_auth',
  secret: config.sessionSecret || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// --- Health Endpoint ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbConfigured: !!connStr,
    environment: process.env.NODE_ENV || 'development',
    runtime: `Node.js ${process.version}`,
    os: `${process.platform} ${process.arch}`,
    arch: process.arch
  });
});

// ==================== BUG REPORT ====================

app.post('/api/bugreport', async (req, res) => {
  try {
    if (isRateLimited(req, 'bugreport', 3, 600))
      return res.status(429).json({ error: 'Zu viele Meldungen. Bitte warte einige Minuten.' });

    if (!githubConfig.token || !githubConfig.owner || !githubConfig.repo)
      return res.status(503).json({ error: 'Bug-Report ist nicht konfiguriert.' });

    const { titel, beschreibung, schritte, kontakt } = req.body;

    if (!titel || !titel.trim() || titel.trim().length > 100)
      return res.status(400).json({ error: 'Titel ist erforderlich (max. 100 Zeichen).' });
    if (!beschreibung || !beschreibung.trim() || beschreibung.trim().length > 2000)
      return res.status(400).json({ error: 'Beschreibung ist erforderlich (max. 2000 Zeichen).' });

    const parts = [`## Beschreibung\n\n${beschreibung.trim()}`];
    if (schritte && schritte.trim()) parts.push(`## Schritte zum Reproduzieren\n\n${schritte.trim()}`);
    if (kontakt && kontakt.trim()) parts.push(`## Kontakt\n\n${kontakt.trim()}`);
    const ua = req.headers['user-agent'] || 'Unbekannt';
    parts.push(`---\n_Gemeldet via App am ${new Date().toISOString()}_\n_User-Agent: ${ua}_`);

    const ghRes = await fetch(
      `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/issues`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubConfig.token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'HaushaltPLUS-App'
        },
        body: JSON.stringify({
          title: `[Bug] ${titel.trim()}`,
          body: parts.join('\n\n'),
          labels: ['bug', 'user-report']
        })
      }
    );

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      console.error('GitHub API error:', ghRes.status, errText);
      return res.status(502).json({ error: 'Fehler beim Erstellen des Bug-Reports.' });
    }

    const issue = await ghRes.json();
    res.json({ success: true, issueNumber: issue.number });
  } catch (err) {
    console.error('bugreport error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== AUTH ENDPOINTS ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    if (isRateLimited(req, 'register', 5, 300))
      return res.status(429).json({ error: 'Zu viele Versuche. Bitte warte einige Minuten.' });

    const { benutzername, passwort, email } = req.body;
    const username = (benutzername || '').trim();
    const password = passwort || '';
    const emailAddr = (email || '').trim();

    if (username.length < 2) return res.status(400).json({ error: 'Benutzername muss mindestens 2 Zeichen haben.' });
    if (password.length < 8) return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben.' });
    if (!/[A-Z]/.test(password)) return res.status(400).json({ error: 'Passwort muss mindestens einen Grossbuchstaben enthalten.' });
    if (!/[a-z]/.test(password)) return res.status(400).json({ error: 'Passwort muss mindestens einen Kleinbuchstaben enthalten.' });
    if (!/[^A-Za-z0-9]/.test(password)) return res.status(400).json({ error: 'Passwort muss mindestens ein Sonderzeichen enthalten.' });
    if (emailAddr.length < 5 || !emailAddr.includes('@')) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });

    const db = await getPool();

    const check = await db.request()
      .input('name', sql.NVarChar, username)
      .query('SELECT COUNT(*) AS cnt FROM Benutzer WHERE Benutzername=@name');
    if (check.recordset[0].cnt > 0)
      return res.status(409).json({ error: 'Benutzername ist bereits vergeben.' });

    const token = crypto.randomBytes(32).toString('base64url');

    const result = await db.request()
      .input('name', sql.NVarChar, username)
      .input('hash', sql.NVarChar, hashPassword(password))
      .input('email', sql.NVarChar, emailAddr)
      .input('token', sql.NVarChar, token)
      .query('INSERT INTO Benutzer (Benutzername, PasswordHash, Email, EmailBestaetigt, AktivierungsToken) OUTPUT INSERTED.Id VALUES (@name, @hash, @email, 0, @token)');

    try {
      await sendActivationEmail(emailAddr, username, token, req);
    } catch (ex) {
      console.error('Aktivierungsmail konnte nicht gesendet werden', ex);
      return res.json({ benutzername: username, mailFehler: true, message: 'Konto erstellt, aber Aktivierungsmail konnte nicht gesendet werden. Bitte kontaktiere den Administrator.' });
    }

    res.json({ benutzername: username, aktivierung: true, message: 'Registrierung erfolgreich! Bitte bestätige deine E-Mail-Adresse.' });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    if (isRateLimited(req, 'login', 10, 60))
      return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte warte eine Minute.' });

    const { benutzername, passwort } = req.body;
    const username = (benutzername || '').trim();
    const password = passwort || '';

    const db = await getPool();
    const result = await db.request()
      .input('name', sql.NVarChar, username)
      .query('SELECT Id, PasswordHash, EmailBestaetigt FROM Benutzer WHERE Benutzername=@name');

    if (result.recordset.length === 0) return res.status(401).json({});

    const row = result.recordset[0];
    if (!verifyPassword(password, row.PasswordHash)) return res.status(401).json({});
    if (!row.EmailBestaetigt)
      return res.status(403).json({ error: 'E-Mail-Adresse noch nicht bestätigt. Bitte prüfe dein Postfach.' });

    req.session.userId = row.Id;
    req.session.userName = username;
    res.json({ benutzername: username });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/auth/aktivieren', async (req, res) => {
  try {
    const token = req.query.token || '';
    const db = await getPool();
    const result = await db.request()
      .input('token', sql.NVarChar, token)
      .query('UPDATE Benutzer SET EmailBestaetigt=1, AktivierungsToken=NULL WHERE AktivierungsToken=@token AND EmailBestaetigt=0');

    const htmlOk = '<html><body style="font-family:sans-serif;text-align:center;padding:3rem"><h2 style="color:#22c55e">&#10003; E-Mail bestätigt!</h2><p>Dein Konto ist jetzt aktiv. Du kannst dich anmelden.</p><a href="/">Zur HaushaltPLUS</a></body></html>';
    const htmlFail = '<html><body style="font-family:sans-serif;text-align:center;padding:3rem"><h2 style="color:#ef4444">Link ungültig</h2><p>Dieser Aktivierungslink ist ungültig oder wurde bereits verwendet.</p><a href="/">Zur HaushaltPLUS</a></body></html>';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rowsAffected[0] > 0 ? htmlOk : htmlFail);
  } catch (err) {
    console.error('aktivieren error:', err);
    res.status(500).send('Fehler');
  }
});

app.post('/api/auth/resend', async (req, res) => {
  try {
    const username = (req.body.benutzername || '').trim();
    const db = await getPool();
    const result = await db.request()
      .input('name', sql.NVarChar, username)
      .query('SELECT Id, Email, AktivierungsToken, Benutzername FROM Benutzer WHERE Benutzername=@name AND EmailBestaetigt=0');

    if (result.recordset.length === 0)
      return res.status(400).json({ error: 'Konto nicht gefunden oder bereits aktiviert.' });

    const row = result.recordset[0];
    const email = row.Email || '';
    const token = row.AktivierungsToken || '';
    const user = row.Benutzername;

    if (!email || !token)
      return res.status(400).json({ error: 'Keine E-Mail oder Token vorhanden.' });

    try {
      await sendActivationEmail(email, user, token, req);
      res.json({ message: 'Aktivierungsmail erneut gesendet.' });
    } catch (ex) {
      console.error('Aktivierungsmail konnte nicht gesendet werden', ex);
      res.status(400).json({ error: 'Mail konnte nicht gesendet werden.' });
    }
  } catch (err) {
    console.error('resend error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/auth/reset-request', async (req, res) => {
  try {
    if (isRateLimited(req, 'reset', 5, 300))
      return res.status(429).json({ error: 'Zu viele Versuche. Bitte warte einige Minuten.' });

    const email = (req.body.email || '').trim();
    if (email.length < 5 || !email.includes('@'))
      return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });

    const db = await getPool();
    const result = await db.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT Id, Benutzername FROM Benutzer WHERE Email=@email');

    const genericMsg = 'Falls ein Konto mit dieser E-Mail existiert, wurde ein Link zum Zurücksetzen gesendet.';

    if (result.recordset.length === 0)
      return res.json({ message: genericMsg });

    const row = result.recordset[0];
    const token = crypto.randomBytes(32).toString('base64url');

    await db.request()
      .input('token', sql.NVarChar, token)
      .input('expiry', sql.DateTime2, new Date(Date.now() + 3600000))
      .input('uid', sql.Int, row.Id)
      .query('UPDATE Benutzer SET ResetToken=@token, ResetTokenExpiry=@expiry WHERE Id=@uid');

    try {
      const host = smtpConfig.host || '';
      const port = smtpConfig.port || 587;
      const user = smtpConfig.user || '';
      const pass = smtpConfig.password || '';
      const fromAddr = smtpConfig.from || user;
      const fromName = smtpConfig.fromName || 'HaushaltPLUS';

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const link = `${baseUrl}/reset.html?token=${encodeURIComponent(token)}`;

      const body = `Hallo ${row.Benutzername},

Du hast ein Zurücksetzen deines Passworts angefordert. Klicke auf folgenden Link:

${link}

Der Link ist 1 Stunde gültig.

Falls du dies nicht angefordert hast, kannst du diese E-Mail ignorieren.

Viele Grüsse
HaushaltPLUS`;

      const transporter = nodemailer.createTransport({
        host, port,
        secure: port === 465,
        auth: { user, pass }
      });

      await transporter.sendMail({
        from: `"${fromName}" <${fromAddr}>`,
        to: email,
        subject: 'HaushaltPLUS – Passwort zurücksetzen',
        text: body
      });
    } catch (ex) {
      console.error('Reset-Mail konnte nicht gesendet werden', ex);
    }

    res.json({ message: genericMsg });
  } catch (err) {
    console.error('reset-request error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/auth/reset', async (req, res) => {
  try {
    const token = (req.body.token || '').trim();
    const password = req.body.passwort || '';

    if (password.length < 8) return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben.' });
    if (!/[A-Z]/.test(password)) return res.status(400).json({ error: 'Passwort muss mindestens einen Grossbuchstaben enthalten.' });
    if (!/[a-z]/.test(password)) return res.status(400).json({ error: 'Passwort muss mindestens einen Kleinbuchstaben enthalten.' });
    if (!/[^A-Za-z0-9]/.test(password)) return res.status(400).json({ error: 'Passwort muss mindestens ein Sonderzeichen enthalten.' });

    const db = await getPool();
    const find = await db.request()
      .input('token', sql.NVarChar, token)
      .input('now', sql.DateTime2, new Date())
      .query('SELECT Id FROM Benutzer WHERE ResetToken=@token AND ResetTokenExpiry>@now');

    if (find.recordset.length === 0)
      return res.status(400).json({ error: 'Link ungültig oder abgelaufen.' });

    const userId = find.recordset[0].Id;
    await db.request()
      .input('hash', sql.NVarChar, hashPassword(password))
      .input('uid', sql.Int, userId)
      .query('UPDATE Benutzer SET PasswordHash=@hash, ResetToken=NULL, ResetTokenExpiry=NULL, EmailBestaetigt=1 WHERE Id=@uid');

    res.json({ message: 'Passwort wurde zurückgesetzt. Du kannst dich jetzt anmelden.' });
  } catch (err) {
    console.error('reset error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('einkauf_auth');
    res.json({});
  });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const result = await db.request()
      .input('uid', sql.Int, userId)
      .query(`SELECT b.Benutzername, h.Id, h.Name, h.Code, b.Email, b.IsAdmin, b.HaushaltRolle, h.ErstelltVon
              FROM Benutzer b LEFT JOIN Haushalt h ON b.HaushaltId=h.Id
              WHERE b.Id=@uid`);

    if (result.recordset.length === 0) return res.status(401).json({});
    const row = result.recordset[0];
    const haushaltRolle = row.HaushaltRolle || 'schreibend';
    const haushaltErstelltVon = row.ErstelltVon;
    const haushalt = row.Id != null ? {
      id: row.Id,
      name: row.Name,
      code: row.Code,
      rolle: haushaltRolle,
      isErsteller: haushaltErstelltVon != null && haushaltErstelltVon === userId
    } : null;

    res.json({
      benutzername: row.Benutzername,
      haushalt,
      email: row.Email || '',
      isAdmin: row.IsAdmin || false
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.put('/api/auth/profil', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const email = (req.body.email || '').trim();
    const db = await getPool();
    await db.request()
      .input('email', sql.NVarChar, email || null)
      .input('uid', sql.Int, userId)
      .query('UPDATE Benutzer SET Email=@email WHERE Id=@uid');
    res.json({});
  } catch (err) {
    console.error('profil error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const oldPassword = req.body.altesPasswort || '';
    const newPassword = req.body.neuesPasswort || '';

    if (newPassword.length < 8) return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben.' });
    if (!/[A-Z]/.test(newPassword)) return res.status(400).json({ error: 'Passwort muss mindestens einen Grossbuchstaben enthalten.' });
    if (!/[a-z]/.test(newPassword)) return res.status(400).json({ error: 'Passwort muss mindestens einen Kleinbuchstaben enthalten.' });
    if (!/[^A-Za-z0-9]/.test(newPassword)) return res.status(400).json({ error: 'Passwort muss mindestens ein Sonderzeichen enthalten.' });

    const db = await getPool();
    const result = await db.request()
      .input('uid', sql.Int, userId)
      .query('SELECT PasswordHash FROM Benutzer WHERE Id=@uid');
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });

    if (!verifyPassword(oldPassword, result.recordset[0].PasswordHash))
      return res.status(400).json({ error: 'Aktuelles Passwort ist falsch.' });

    await db.request()
      .input('hash', sql.NVarChar, hashPassword(newPassword))
      .input('uid', sql.Int, userId)
      .query('UPDATE Benutzer SET PasswordHash=@hash WHERE Id=@uid');
    res.json({ message: 'Passwort geändert.' });
  } catch (err) {
    console.error('change-password error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ── Tankrabatte Endpoint ─────────────────────────────────────────────

// Cache: 1 Stunde
let tankrabatteCache = { data: null, timestamp: 0 };
const TANKRABATTE_CACHE_TTL = 60 * 60 * 1000;

async function scrapePreispirat(anbieter) {
  const https = require('https');
  const url = `https://www.preispirat.ch/gutscheine/${anbieter}/`;
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } }, (resp) => {
      let html = '';
      resp.on('data', chunk => html += chunk);
      resp.on('end', () => {
        const gutscheine = [];
        // Einfaches Regex-Parsing der deal_block_row Einträge
        const blocks = html.split('deal_block_row');
        for (let i = 1; i < blocks.length; i++) {
          const block = blocks[i];
          // Titel extrahieren
          const titelMatch = block.match(/<a[^>]*href="(https:\/\/www\.preispirat\.ch\/[^"]*)"[^>]*>([^<]+)<\/a>/);
          // Rabatt extrahieren (im h5-Tag)
          const rabattMatch = block.match(/<h5[^>]*>([^<]+)<\/h5>/);
          // Abgelaufen?
          const abgelaufen = block.includes('expired_coupon') || block.includes('Abgelaufen');
          if (titelMatch) {
            gutscheine.push({
              titel: (titelMatch[2] || '').trim(),
              url: (titelMatch[1] || '').trim(),
              rabatt: rabattMatch ? rabattMatch[1].trim() : 'Rabatt',
              abgelaufen,
              details: abgelaufen ? 'Abgelaufen' : 'Aktiv'
            });
          }
        }
        resolve(gutscheine);
      });
      resp.on('error', () => resolve([]));
    }).on('error', () => resolve([]));
  });
}

async function scrapeShellCh() {
  const https = require('https');
  const url = 'https://www.shell.ch/de_ch/shoppen-und-geniessen/aktuelle-angebote.html';
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } }, (resp) => {
      let html = '';
      resp.on('data', chunk => html += chunk);
      resp.on('end', () => {
        const gutscheine = [];
        // Shell-Seite: Angebote aus Promo-Blöcken extrahieren
        const promoRegex = /<h[23][^>]*>([^<]*(?:rabatt|rappen|cent|sparen|tanken)[^<]*)<\/h[23]>/gi;
        let m;
        while ((m = promoRegex.exec(html)) !== null) {
          gutscheine.push({
            titel: m[1].trim(),
            url,
            rabatt: 'Aktion',
            abgelaufen: false,
            details: 'shell.ch'
          });
        }
        resolve(gutscheine);
      });
      resp.on('error', () => resolve([]));
    }).on('error', () => resolve([]));
  });
}

app.get('/api/tankrabatte', requireAuth, async (req, res) => {
  try {
    if (tankrabatteCache.data && Date.now() - tankrabatteCache.timestamp < TANKRABATTE_CACHE_TTL) {
      return res.json(tankrabatteCache.data);
    }

    const [coopPronto, migrol, shell] = await Promise.all([
      scrapePreispirat('coop-pronto'),
      scrapePreispirat('migrol'),
      scrapeShellCh()
    ]);

    // AVIA: Kein öffentlicher Gutschein-Service, statischer Hinweis
    const avia = [{
      titel: 'AVIA Karte: 4-5 Rp./Liter Rabatt an allen AVIA-Stationen',
      url: 'https://avia.ch',
      rabatt: '4-5 Rp./L',
      abgelaufen: false,
      details: 'Dauerhaft mit AVIA-Karte'
    }];

    const data = { coopPronto, migrol, shell, avia };
    tankrabatteCache = { data, timestamp: Date.now() };
    res.json(data);
  } catch (e) {
    console.error('Tankrabatte Fehler:', e);
    res.status(500).json({ error: 'Fehler beim Laden der Tankrabatte.' });
  }
});

// ── WebAuthn / FIDO2 Endpoints ──────────────────────────────────────

app.post('/api/webauthn/register-options', requireAuth, async (req, res) => {
  try {
    if (isRateLimited(req, 'webauthn_register', 10, 60)) return res.status(429).json({ error: 'Zu viele Versuche.' });
    const { geraetename } = req.body;
    if (!geraetename || geraetename.trim().length < 1) return res.status(400).json({ error: 'Gerätename erforderlich.' });

    const db = await getPool();
    const userResult = await db.request()
      .input('userId', sql.Int, req.session.userId)
      .query('SELECT Id, Benutzername FROM Benutzer WHERE Id=@userId');
    const user = userResult.recordset[0];
    if (!user) return res.status(401).json({ error: 'Nicht authentifiziert.' });

    // Bereits registrierte Credentials laden (für excludeCredentials)
    const existing = await db.request()
      .input('userId', sql.Int, req.session.userId)
      .query('SELECT CredentialId, Transports FROM WebAuthnCredential WHERE BenutzerId=@userId');

    const excludeCredentials = existing.recordset.map(c => ({
      id: c.CredentialId,
      transports: c.Transports ? JSON.parse(c.Transports) : undefined
    }));

    const waCfg = getWebauthnConfig(req);
    const options = await generateRegistrationOptions({
      rpName: waCfg.rpName,
      rpID: waCfg.rpID,
      userID: new Uint8Array(Buffer.from(user.Id.toString())),
      userName: user.Benutzername,
      userDisplayName: user.Benutzername,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform'
      }
    });

    req.session.webauthnChallenge = {
      challenge: options.challenge,
      expires: Date.now() + 60000,
      geraetename: geraetename.trim()
    };

    res.json(options);
  } catch (e) {
    console.error('WebAuthn register-options Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/webauthn/register-verify', requireAuth, async (req, res) => {
  try {
    const challengeData = req.session.webauthnChallenge;
    if (!challengeData) return res.status(400).json({ error: 'Keine Challenge vorhanden.' });
    if (Date.now() > challengeData.expires) {
      delete req.session.webauthnChallenge;
      return res.status(400).json({ error: 'Challenge abgelaufen. Bitte erneut versuchen.' });
    }

    const waCfg = getWebauthnConfig(req);
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: waCfg.origin,
      expectedRPID: waCfg.rpID
    });

    if (!verification.verified || !verification.registrationInfo) {
      delete req.session.webauthnChallenge;
      return res.status(400).json({ error: 'Verifizierung fehlgeschlagen.' });
    }

    const { credential } = verification.registrationInfo;

    const db = await getPool();
    await db.request()
      .input('benutzerId', sql.Int, req.session.userId)
      .input('credentialId', sql.NVarChar, credential.id)
      .input('publicKey', sql.VarBinary, Buffer.from(credential.publicKey))
      .input('counter', sql.Int, credential.counter)
      .input('geraetename', sql.NVarChar, challengeData.geraetename)
      .input('transports', sql.NVarChar, req.body.response?.transports ? JSON.stringify(req.body.response.transports) : null)
      .query(`INSERT INTO WebAuthnCredential (BenutzerId, CredentialId, PublicKey, Counter, Geraetename, Transports)
              VALUES (@benutzerId, @credentialId, @publicKey, @counter, @geraetename, @transports)`);

    delete req.session.webauthnChallenge;
    res.json({ verifiziert: true, credentialId: credential.id });
  } catch (e) {
    console.error('WebAuthn register-verify Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/webauthn/login-options', async (req, res) => {
  try {
    if (isRateLimited(req, 'webauthn_login', 10, 60)) return res.status(429).json({ error: 'Zu viele Versuche.' });
    const { benutzername } = req.body;
    if (!benutzername) return res.status(400).json({ error: 'Benutzername erforderlich.' });

    const db = await getPool();
    const userResult = await db.request()
      .input('name', sql.NVarChar, benutzername)
      .query('SELECT Id FROM Benutzer WHERE Benutzername=@name');

    let allowCredentials = [];
    let userId = null;

    if (userResult.recordset.length > 0) {
      userId = userResult.recordset[0].Id;
      const creds = await db.request()
        .input('userId', sql.Int, userId)
        .query('SELECT CredentialId, Transports FROM WebAuthnCredential WHERE BenutzerId=@userId');

      allowCredentials = creds.recordset.map(c => ({
        id: c.CredentialId,
        transports: c.Transports ? JSON.parse(c.Transports) : undefined
      }));
    }

    // Fake-Credentials für unbekannte User (User-Enumeration-Schutz)
    if (allowCredentials.length === 0) {
      const fakeCount = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < fakeCount; i++) {
        allowCredentials.push({
          id: crypto.randomBytes(32).toString('base64url'),
          transports: ['internal']
        });
      }
    }

    const waCfg = getWebauthnConfig(req);
    const options = await generateAuthenticationOptions({
      rpID: waCfg.rpID,
      allowCredentials,
      userVerification: 'preferred'
    });

    req.session.webauthnChallenge = {
      challenge: options.challenge,
      expires: Date.now() + 60000,
      webauthnUserId: userId
    };

    res.json(options);
  } catch (e) {
    console.error('WebAuthn login-options Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/webauthn/login-verify', async (req, res) => {
  try {
    const challengeData = req.session.webauthnChallenge;
    if (!challengeData) return res.status(400).json({ error: 'Keine Challenge vorhanden.' });
    if (Date.now() > challengeData.expires) {
      delete req.session.webauthnChallenge;
      return res.status(400).json({ error: 'Challenge abgelaufen. Bitte erneut versuchen.' });
    }
    if (!challengeData.webauthnUserId) {
      delete req.session.webauthnChallenge;
      return res.status(400).json({ error: 'Anmeldung fehlgeschlagen.' });
    }

    // Credential aus DB laden
    const db = await getPool();
    const credResult = await db.request()
      .input('credId', sql.NVarChar, req.body.id)
      .input('userId', sql.Int, challengeData.webauthnUserId)
      .query('SELECT Id, CredentialId, PublicKey, Counter, Transports FROM WebAuthnCredential WHERE CredentialId=@credId AND BenutzerId=@userId');

    if (credResult.recordset.length === 0) {
      delete req.session.webauthnChallenge;
      return res.status(400).json({ error: 'Anmeldung fehlgeschlagen.' });
    }

    const cred = credResult.recordset[0];

    const waCfg = getWebauthnConfig(req);
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: waCfg.origin,
      expectedRPID: waCfg.rpID,
      credential: {
        id: cred.CredentialId,
        publicKey: cred.PublicKey,
        counter: cred.Counter,
        transports: cred.Transports ? JSON.parse(cred.Transports) : undefined
      }
    });

    if (!verification.verified) {
      delete req.session.webauthnChallenge;
      return res.status(400).json({ error: 'Anmeldung fehlgeschlagen.' });
    }

    // Account-Status prüfen (identisch zum Passwort-Login)
    const userResult = await db.request()
      .input('userId', sql.Int, challengeData.webauthnUserId)
      .query('SELECT Id, Benutzername, EmailBestaetigt FROM Benutzer WHERE Id=@userId');

    const user = userResult.recordset[0];
    if (!user) {
      delete req.session.webauthnChallenge;
      return res.status(400).json({ error: 'Anmeldung fehlgeschlagen.' });
    }
    if (!user.EmailBestaetigt) {
      delete req.session.webauthnChallenge;
      return res.status(403).json({ error: 'Konto nicht aktiviert.' });
    }

    // Counter aktualisieren
    await db.request()
      .input('id', sql.Int, cred.Id)
      .input('counter', sql.Int, verification.authenticationInfo.newCounter)
      .query('UPDATE WebAuthnCredential SET Counter=@counter WHERE Id=@id');

    // Session erstellen (identisch zum Passwort-Login in server.js:607-608)
    req.session.userId = user.Id;
    req.session.userName = user.Benutzername;

    delete req.session.webauthnChallenge;
    res.json({ verifiziert: true, benutzer: { id: user.Id, benutzername: user.Benutzername } });
  } catch (e) {
    console.error('WebAuthn login-verify Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/webauthn/credentials', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('userId', sql.Int, req.session.userId)
      .query('SELECT Id, Geraetename, ErstelltAm FROM WebAuthnCredential WHERE BenutzerId=@userId ORDER BY ErstelltAm DESC');
    res.json(result.recordset.map(r => ({
      id: r.Id,
      geraetename: r.Geraetename,
      erstelltAm: r.ErstelltAm
    })));
  } catch (e) {
    console.error('WebAuthn credentials list Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/webauthn/credentials/:id', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('userId', sql.Int, req.session.userId)
      .query('DELETE FROM WebAuthnCredential WHERE Id=@id AND BenutzerId=@userId');
    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Gerät nicht gefunden.' });
    res.json({ erfolg: true });
  } catch (e) {
    console.error('WebAuthn credential delete Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== HAUSHALT ENDPOINTS ====================

app.post('/api/haushalt', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const name = (req.body.name || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Name muss mindestens 2 Zeichen haben.' });

    const db = await getPool();
    const existingHid = await getHaushaltId(userId, db);
    if (existingHid != null) return res.status(400).json({ error: 'Du bist bereits in einem Haushalt.' });

    const code = generateCode();
    const result = await db.request()
      .input('name', sql.NVarChar, name)
      .input('code', sql.NVarChar, code)
      .input('uid', sql.Int, userId)
      .query('INSERT INTO Haushalt (Name, Code, ErstelltVon) OUTPUT INSERTED.Id VALUES (@name, @code, @uid)');
    const haushaltId = result.recordset[0].Id;

    await db.request()
      .input('hid', sql.Int, haushaltId)
      .input('uid', sql.Int, userId)
      .query("UPDATE Benutzer SET HaushaltId=@hid, HaushaltRolle='admin' WHERE Id=@uid");

    await db.request()
      .input('hid', sql.Int, haushaltId)
      .input('uid', sql.Int, userId)
      .query('UPDATE Artikel SET HaushaltId=@hid WHERE BenutzerId=@uid AND HaushaltId IS NULL');

    res.json({ id: haushaltId, name, code });
  } catch (err) {
    console.error('haushalt create error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/haushalt/join', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const code = (req.body.code || '').trim().toUpperCase();

    const db = await getPool();
    const existingHid = await getHaushaltId(userId, db);
    if (existingHid != null) return res.status(400).json({ error: 'Du bist bereits in einem Haushalt. Zuerst verlassen.' });

    const find = await db.request()
      .input('code', sql.NVarChar, code)
      .query('SELECT Id, Name FROM Haushalt WHERE Code=@code');
    if (find.recordset.length === 0) return res.status(404).json({ error: 'Haushalt nicht gefunden.' });

    const haushaltId = find.recordset[0].Id;
    const haushaltName = find.recordset[0].Name;

    await db.request()
      .input('hid', sql.Int, haushaltId)
      .input('uid', sql.Int, userId)
      .query("UPDATE Benutzer SET HaushaltId=@hid, HaushaltRolle='schreibend' WHERE Id=@uid");

    await db.request()
      .input('hid', sql.Int, haushaltId)
      .input('uid', sql.Int, userId)
      .query('UPDATE Artikel SET HaushaltId=@hid WHERE BenutzerId=@uid AND HaushaltId IS NULL');

    res.json({ id: haushaltId, name: haushaltName });
  } catch (err) {
    console.error('haushalt join error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/haushalt/leave', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    await db.request()
      .input('uid', sql.Int, userId)
      .query("UPDATE Benutzer SET HaushaltId=NULL, HaushaltRolle='schreibend' WHERE Id=@uid");

    await db.request()
      .input('uid', sql.Int, userId)
      .query('UPDATE Artikel SET HaushaltId=NULL WHERE BenutzerId=@uid');

    if (hid != null) {
      const count = await db.request()
        .input('hid', sql.Int, hid)
        .query('SELECT COUNT(*) AS cnt FROM Benutzer WHERE HaushaltId=@hid');
      if (count.recordset[0].cnt === 0) {
        await deleteHaushaltCascade(hid, db);
      }
    }

    res.json({});
  } catch (err) {
    console.error('haushalt leave error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/haushalt/mitglieder', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);
    if (hid == null) return res.json([]);

    let erstelltVon = null;
    const hvResult = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT ErstelltVon FROM Haushalt WHERE Id=@hid');
    if (hvResult.recordset.length > 0 && hvResult.recordset[0].ErstelltVon != null) {
      erstelltVon = hvResult.recordset[0].ErstelltVon;
    }

    const result = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT Id, Benutzername, HaushaltRolle FROM Benutzer WHERE HaushaltId=@hid');

    const members = result.recordset.map(r => ({
      id: r.Id,
      benutzername: r.Benutzername,
      rolle: r.HaushaltRolle,
      isErsteller: erstelltVon != null && r.Id === erstelltVon
    }));
    res.json(members);
  } catch (err) {
    console.error('mitglieder error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.put('/api/haushalt/rolle', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const targetUserId = req.body.userId;
    const rolle = (req.body.rolle || '').trim();
    if (rolle !== 'schreibend' && rolle !== 'lesend')
      return res.status(400).json({ error: 'Ungültige Rolle.' });

    const db = await getPool();
    const hid = await getHaushaltId(userId, db);
    if (hid == null) return res.status(400).json({ error: 'Du bist in keinem Haushalt.' });

    const check = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT ErstelltVon FROM Haushalt WHERE Id=@hid');
    const creatorId = check.recordset[0]?.ErstelltVon;
    if (creatorId == null || creatorId !== userId) return res.status(403).json({});

    if (targetUserId === userId)
      return res.status(400).json({ error: 'Du kannst deine eigene Rolle nicht ändern.' });

    const update = await db.request()
      .input('rolle', sql.NVarChar, rolle)
      .input('tid', sql.Int, targetUserId)
      .input('hid', sql.Int, hid)
      .query('UPDATE Benutzer SET HaushaltRolle=@rolle WHERE Id=@tid AND HaushaltId=@hid');
    if (update.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({});
  } catch (err) {
    console.error('rolle error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== LADEN ENDPOINT ====================

app.get('/api/laden', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request()
      .query('SELECT Id, Name FROM Laden ORDER BY Name');
    res.json(result.recordset.map(r => ({ id: r.Id, name: r.Name })));
  } catch (err) {
    console.error('laden error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== ARTIKEL ENDPOINTS ====================

app.get('/api/artikel', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    let result;
    if (hid != null) {
      result = await db.request()
        .input('hid', sql.Int, hid)
        .query('SELECT a.Id, a.Artikel, a.Menge, a.Einheit, a.Laden, a.Datum, a.Gekauft, a.ErstelltAm, b.Benutzername FROM Artikel a JOIN Benutzer b ON a.BenutzerId=b.Id WHERE a.HaushaltId=@hid ORDER BY a.Id');
    } else {
      result = await db.request()
        .input('uid', sql.Int, userId)
        .query('SELECT a.Id, a.Artikel, a.Menge, a.Einheit, a.Laden, a.Datum, a.Gekauft, a.ErstelltAm, NULL AS Benutzername FROM Artikel a WHERE a.BenutzerId=@uid AND a.HaushaltId IS NULL ORDER BY a.Id');
    }

    const items = result.recordset.map(r => ({
      id: r.Id,
      artikel: r.Artikel,
      menge: r.Menge,
      einheit: r.Einheit,
      laden: r.Laden || '',
      datum: r.Datum ? r.Datum.toISOString().substring(0, 10) : '',
      gekauft: r.Gekauft,
      erstelltAm: r.ErstelltAm ? r.ErstelltAm.toISOString() : '',
      von: r.Benutzername || null
    }));
    res.json(items);
  } catch (err) {
    console.error('artikel get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/artikel', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const { artikel, menge, einheit, laden, datum } = req.body;
    const result = await db.request()
      .input('artikel', sql.NVarChar, artikel)
      .input('menge', sql.Decimal(18, 2), menge)
      .input('einheit', sql.NVarChar, einheit)
      .input('laden', sql.NVarChar, laden || null)
      .input('datum', sql.DateTime2, datum ? new Date(datum) : null)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query('INSERT INTO Artikel (Artikel, Menge, Einheit, Laden, Datum, BenutzerId, HaushaltId) OUTPUT INSERTED.Id, INSERTED.ErstelltAm VALUES (@artikel, @menge, @einheit, @laden, @datum, @uid, @hid)');

    const row = result.recordset[0];
    res.json({ id: row.Id, erstelltAm: row.ErstelltAm.toISOString() });
  } catch (err) {
    console.error('artikel post error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.put('/api/artikel/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const { artikel, menge, einheit, laden, datum, gekauft } = req.body;
    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';
    const request = db.request()
      .input('id', sql.Int, id)
      .input('artikel', sql.NVarChar, artikel)
      .input('menge', sql.Decimal(18, 2), menge)
      .input('einheit', sql.NVarChar, einheit)
      .input('laden', sql.NVarChar, laden || null)
      .input('datum', sql.DateTime2, datum ? new Date(datum) : null)
      .input('gekauft', sql.Bit, gekauft ? true : false);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`UPDATE Artikel SET Artikel=@artikel, Menge=@menge, Einheit=@einheit, Laden=@laden, Datum=@datum, Gekauft=@gekauft WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({});
  } catch (err) {
    console.error('artikel put error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/artikel/gekauft', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'Gekauft=1 AND HaushaltId=@hid' : 'Gekauft=1 AND BenutzerId=@uid';
    const request = db.request();
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`DELETE FROM Artikel WHERE ${where}`);
    res.json({ deleted: result.rowsAffected[0] });
  } catch (err) {
    console.error('artikel delete gekauft error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/artikel/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`DELETE FROM Artikel WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({});
  } catch (err) {
    console.error('artikel delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== WOCHENPLAN ENDPOINTS ====================

app.get('/api/wochenplan', requireAuth, async (req, res) => {
  try {
    const woche = req.query.woche;
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request().input('woche', sql.DateTime2, new Date(woche));
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT Id, Tag, Mahlzeit, Rezept, Erwachsene, Kinder FROM Wochenplan WHERE Woche=@woche AND ${where} ORDER BY Tag, Mahlzeit`);
    res.json(result.recordset.map(r => ({
      id: r.Id, tag: r.Tag, mahlzeit: r.Mahlzeit, rezept: r.Rezept, erwachsene: r.Erwachsene, kinder: r.Kinder
    })));
  } catch (err) {
    console.error('wochenplan get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/wochenplan', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const { woche, tag, mahlzeit, rezept, erwachsene, kinder } = req.body;
    await db.request()
      .input('woche', sql.DateTime2, new Date(woche))
      .input('tag', sql.Int, tag)
      .input('mahlzeit', sql.NVarChar, mahlzeit)
      .input('rezept', sql.NVarChar, rezept)
      .input('erw', sql.Int, erwachsene != null ? erwachsene : 2)
      .input('kind', sql.Int, kinder != null ? kinder : 0)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query(`MERGE Wochenplan AS t
              USING (SELECT @woche AS Woche, @tag AS Tag, @mahlzeit AS Mahlzeit, @uid AS BenutzerId) AS s
              ON t.Woche=s.Woche AND t.Tag=s.Tag AND t.Mahlzeit=s.Mahlzeit AND t.BenutzerId=s.BenutzerId
              WHEN MATCHED THEN UPDATE SET Rezept=@rezept, Erwachsene=@erw, Kinder=@kind
              WHEN NOT MATCHED THEN INSERT (Woche,Tag,Mahlzeit,Rezept,Erwachsene,Kinder,BenutzerId,HaushaltId) VALUES (@woche,@tag,@mahlzeit,@rezept,@erw,@kind,@uid,@hid);`);
    res.json({});
  } catch (err) {
    console.error('wochenplan post error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/wochenplan/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    await request.query(`DELETE FROM Wochenplan WHERE ${where}`);
    res.json({});
  } catch (err) {
    console.error('wochenplan delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== ADMIN ENDPOINTS ====================

app.get('/api/admin/benutzer', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    const result = await db.request().query(`
      SELECT b.Id, b.Benutzername, b.Email, b.EmailBestaetigt, b.IsAdmin, b.ErstelltAm, h.Name AS Haushalt
      FROM Benutzer b LEFT JOIN Haushalt h ON b.HaushaltId=h.Id
      ORDER BY b.Id`);

    res.json(result.recordset.map(r => ({
      id: r.Id,
      benutzername: r.Benutzername,
      email: r.Email || '',
      emailBestaetigt: r.EmailBestaetigt,
      isAdmin: r.IsAdmin,
      erstelltAm: r.ErstelltAm ? formatDate(r.ErstelltAm) : '',
      haushalt: r.Haushalt || ''
    })));
  } catch (err) {
    console.error('admin benutzer get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

app.put('/api/admin/benutzer/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    if (req.body.emailBestaetigt !== undefined) {
      await db.request()
        .input('val', sql.Bit, req.body.emailBestaetigt)
        .input('id', sql.Int, id)
        .query('UPDATE Benutzer SET EmailBestaetigt=@val WHERE Id=@id');
    }
    if (req.body.isAdmin !== undefined) {
      await db.request()
        .input('val', sql.Bit, req.body.isAdmin)
        .input('id', sql.Int, id)
        .query('UPDATE Benutzer SET IsAdmin=@val WHERE Id=@id');
    }
    if (req.body.passwort && req.body.passwort.length >= 8 && /[A-Z]/.test(req.body.passwort) && /[a-z]/.test(req.body.passwort) && /[^A-Za-z0-9]/.test(req.body.passwort)) {
      await db.request()
        .input('hash', sql.NVarChar, hashPassword(req.body.passwort))
        .input('id', sql.Int, id)
        .query('UPDATE Benutzer SET PasswordHash=@hash WHERE Id=@id');
    }
    res.json({});
  } catch (err) {
    console.error('admin benutzer put error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/admin/benutzer/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});
    if (id === userId) return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen.' });

    await db.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM Benutzer WHERE Id=@id');
    res.json({});
  } catch (err) {
    console.error('admin benutzer delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// --- Admin Haushalt Endpoints ---

app.get('/api/admin/haushalte', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    const result = await db.request().query(`
      SELECT h.Id, h.Name, h.Code, h.ErstelltVon, b.Benutzername AS ErstelltVonName,
          (SELECT COUNT(*) FROM Benutzer WHERE HaushaltId=h.Id) AS Mitglieder
      FROM Haushalt h LEFT JOIN Benutzer b ON h.ErstelltVon=b.Id
      ORDER BY h.Id`);

    res.json(result.recordset.map(r => ({
      id: r.Id,
      name: r.Name,
      code: r.Code,
      erstelltVon: r.ErstelltVonName || '',
      mitglieder: r.Mitglieder
    })));
  } catch (err) {
    console.error('admin haushalte get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/admin/haushalte/:id/mitglieder', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    let erstelltVon = null;
    const hvResult = await db.request()
      .input('hid', sql.Int, id)
      .query('SELECT ErstelltVon FROM Haushalt WHERE Id=@hid');
    if (hvResult.recordset.length > 0 && hvResult.recordset[0].ErstelltVon != null) {
      erstelltVon = hvResult.recordset[0].ErstelltVon;
    }

    const result = await db.request()
      .input('hid', sql.Int, id)
      .query('SELECT Id, Benutzername, HaushaltRolle FROM Benutzer WHERE HaushaltId=@hid');

    res.json(result.recordset.map(r => ({
      id: r.Id,
      benutzername: r.Benutzername,
      rolle: r.HaushaltRolle,
      isErsteller: erstelltVon != null && r.Id === erstelltVon
    })));
  } catch (err) {
    console.error('admin haushalte mitglieder error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.put('/api/admin/haushalte/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    if (req.body.name !== undefined) {
      await db.request()
        .input('name', sql.NVarChar, (req.body.name || '').trim())
        .input('id', sql.Int, id)
        .query('UPDATE Haushalt SET Name=@name WHERE Id=@id');
    }
    res.json({});
  } catch (err) {
    console.error('admin haushalte put error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.put('/api/admin/haushalte/:hid/mitglieder/:uid', requireAuth, async (req, res) => {
  try {
    const hid = parseInt(req.params.hid);
    const uid = parseInt(req.params.uid);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    if (req.body.rolle !== undefined) {
      const rolle = (req.body.rolle || '').trim();
      if (rolle !== 'admin' && rolle !== 'schreibend' && rolle !== 'lesend')
        return res.status(400).json({ error: 'Ungültige Rolle.' });
      await db.request()
        .input('rolle', sql.NVarChar, rolle)
        .input('uid', sql.Int, uid)
        .input('hid', sql.Int, hid)
        .query('UPDATE Benutzer SET HaushaltRolle=@rolle WHERE Id=@uid AND HaushaltId=@hid');
    }
    res.json({});
  } catch (err) {
    console.error('admin haushalte mitglieder put error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/admin/haushalte/:hid/mitglieder/:uid', requireAuth, async (req, res) => {
  try {
    const hid = parseInt(req.params.hid);
    const uid = parseInt(req.params.uid);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    await db.request()
      .input('uid', sql.Int, uid)
      .input('hid', sql.Int, hid)
      .query("UPDATE Benutzer SET HaushaltId=NULL, HaushaltRolle='schreibend' WHERE Id=@uid AND HaushaltId=@hid");

    const count = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT COUNT(*) AS cnt FROM Benutzer WHERE HaushaltId=@hid');
    if (count.recordset[0].cnt === 0) {
      await deleteHaushaltCascade(hid, db);
    }

    res.json({});
  } catch (err) {
    console.error('admin haushalte mitglieder delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/admin/haushalte/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    // Remove all members from household first
    await db.request()
      .input('hid', sql.Int, id)
      .query("UPDATE Benutzer SET HaushaltId=NULL, HaushaltRolle='schreibend' WHERE HaushaltId=@hid");

    await deleteHaushaltCascade(id, db);
    res.json({});
  } catch (err) {
    console.error('admin haushalte delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// --- Admin Laden Endpoints ---

app.post('/api/admin/laden', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name darf nicht leer sein.' });

    const dup = await db.request()
      .input('name', sql.NVarChar, name)
      .query('SELECT Id FROM Laden WHERE LOWER(Name)=LOWER(@name)');
    if (dup.recordset.length > 0) return res.status(400).json({ error: 'Laden mit diesem Namen existiert bereits.' });

    const result = await db.request()
      .input('name', sql.NVarChar, name)
      .query('INSERT INTO Laden (Name, Sortierung) VALUES (@name, 0); SELECT SCOPE_IDENTITY() AS id');
    res.json({ id: result.recordset[0].id, name });
  } catch (err) {
    console.error('admin laden post error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.put('/api/admin/laden/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name darf nicht leer sein.' });

    const dup = await db.request()
      .input('name', sql.NVarChar, name)
      .input('id', sql.Int, id)
      .query('SELECT Id FROM Laden WHERE LOWER(Name)=LOWER(@name) AND Id<>@id');
    if (dup.recordset.length > 0) return res.status(400).json({ error: 'Laden mit diesem Namen existiert bereits.' });

    await db.request()
      .input('name', sql.NVarChar, name)
      .input('id', sql.Int, id)
      .query('UPDATE Laden SET Name=@name WHERE Id=@id');
    res.json({});
  } catch (err) {
    console.error('admin laden put error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/admin/laden/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    const laden = await db.request()
      .input('id', sql.Int, id)
      .query('SELECT Name FROM Laden WHERE Id=@id');
    if (laden.recordset.length === 0) return res.status(404).json({ error: 'Laden nicht gefunden.' });

    const ladenName = laden.recordset[0].Name;
    const articles = await db.request()
      .input('name', sql.NVarChar, ladenName)
      .query('SELECT COUNT(*) AS cnt FROM Artikel WHERE Laden=@name');
    if (articles.recordset[0].cnt > 0) {
      return res.status(400).json({ error: `Laden kann nicht gelöscht werden – ${articles.recordset[0].cnt} Artikel verknüpft.` });
    }

    await db.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM Laden WHERE Id=@id');
    res.json({});
  } catch (err) {
    console.error('admin laden delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== GERICHTE ENDPOINTS ====================

app.get('/api/gerichte', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request();
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT Id, Name, ErstelltAm FROM Gericht WHERE ${where} ORDER BY Name`);
    res.json(result.recordset.map(r => ({ id: r.Id, name: r.Name })));
  } catch (err) {
    console.error('gerichte get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/gerichte/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'g.HaushaltId=@hid' : 'g.BenutzerId=@uid AND g.HaushaltId IS NULL';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT g.Id, g.Name FROM Gericht g WHERE g.Id=@id AND ${where}`);
    if (result.recordset.length === 0) return res.status(404).json({});

    const gericht = result.recordset[0];
    const zResult = await db.request()
      .input('gid', sql.Int, id)
      .query('SELECT Id, Artikel, Menge, Einheit FROM GerichtZutat WHERE GerichtId=@gid ORDER BY Id');

    res.json({
      id: gericht.Id,
      name: gericht.Name,
      zutaten: zResult.recordset.map(z => ({
        id: z.Id, artikel: z.Artikel, menge: z.Menge, einheit: z.Einheit
      }))
    });
  } catch (err) {
    console.error('gerichte get by id error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/gerichte', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const name = (req.body.name || '').trim();
    if (name.length < 1) return res.status(400).json({ error: 'Name ist erforderlich.' });

    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const result = await db.request()
      .input('name', sql.NVarChar, name)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query('INSERT INTO Gericht (Name, BenutzerId, HaushaltId) OUTPUT INSERTED.Id VALUES (@name, @uid, @hid)');
    const gerichtId = result.recordset[0].Id;

    if (req.body.zutaten && Array.isArray(req.body.zutaten)) {
      for (const z of req.body.zutaten) {
        const artikel = (z.artikel || '').trim();
        if (!artikel) continue;
        await db.request()
          .input('gid', sql.Int, gerichtId)
          .input('artikel', sql.NVarChar, artikel)
          .input('menge', sql.Decimal(18, 2), z.menge != null ? z.menge : 1)
          .input('einheit', sql.NVarChar, z.einheit || 'Stück')
          .query('INSERT INTO GerichtZutat (GerichtId, Artikel, Menge, Einheit) VALUES (@gid, @artikel, @menge, @einheit)');
      }
    }

    res.json({ id: gerichtId });
  } catch (err) {
    console.error('gerichte post error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.put('/api/gerichte/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';

    if (req.body.name !== undefined) {
      const request = db.request()
        .input('id', sql.Int, id)
        .input('name', sql.NVarChar, (req.body.name || '').trim());
      if (hid != null) request.input('hid', sql.Int, hid);
      else request.input('uid', sql.Int, userId);
      const result = await request.query(`UPDATE Gericht SET Name=@name WHERE ${where}`);
      if (result.rowsAffected[0] === 0) return res.status(404).json({});
    }

    if (req.body.zutaten !== undefined && Array.isArray(req.body.zutaten)) {
      await db.request()
        .input('gid', sql.Int, id)
        .query('DELETE FROM GerichtZutat WHERE GerichtId=@gid');

      for (const z of req.body.zutaten) {
        const artikel = (z.artikel || '').trim();
        if (!artikel) continue;
        await db.request()
          .input('gid', sql.Int, id)
          .input('artikel', sql.NVarChar, artikel)
          .input('menge', sql.Decimal(18, 2), z.menge != null ? z.menge : 1)
          .input('einheit', sql.NVarChar, z.einheit || 'Stück')
          .query('INSERT INTO GerichtZutat (GerichtId, Artikel, Menge, Einheit) VALUES (@gid, @artikel, @menge, @einheit)');
      }
    }

    res.json({});
  } catch (err) {
    console.error('gerichte put error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/gerichte/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`DELETE FROM Gericht WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({});
  } catch (err) {
    console.error('gerichte delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== REZEPT ENDPOINTS ====================

app.get('/api/rezept/suche', requireAuth, async (req, res) => {
  try {
    const q = req.query.q || '';
    const eq = encodeURIComponent(q);
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    const sources = [
      { name: 'Betty Bossi', url: `https://www.bettybossi.ch/de/rezepte/?query=${eq}&filters=rezepte`, parser: (html) => parseBettyBossi(html) },
      { name: 'Migusto', url: `https://migusto.migros.ch/de/suche?query=${eq}`, parser: (html) => parseJsonLdRecipes(html, 'https://migusto.migros.ch') },
      { name: 'Fooby', url: `https://fooby.ch/de/suche?query=${eq}`, parser: (html) => parseJsonLdRecipes(html, 'https://fooby.ch') },
      { name: 'Chefkoch', url: `https://www.chefkoch.de/rs/s0/${eq}/Rezepte.html`, parser: (html) => parseChefkoch(html) },
      { name: 'Swissmilk', url: `https://www.swissmilk.ch/de/rezepte-kochideen/?search=${eq}`, parser: (html) => parseJsonLdRecipes(html, 'https://www.swissmilk.ch') },
      { name: 'GuteKüche', url: `https://www.gutekueche.ch/search?search=${eq}`, parser: (html) => parseGuteKueche(html) },
      { name: 'Veg Recipes of India', url: `https://www.vegrecipesofindia.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://www.vegrecipesofindia.com', 'Veg Recipes of India') },
      { name: 'Indian Healthy Recipes', url: `https://www.indianhealthyrecipes.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://www.indianhealthyrecipes.com', 'Indian Healthy Recipes') },
      { name: 'Cook with Pranji', url: `https://cookwithpranji.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://cookwithpranji.com', 'Cook with Pranji') },
      { name: 'Padhuskitchen', url: `https://www.padhuskitchen.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://www.padhuskitchen.com', 'Padhuskitchen') },
      { name: 'Hebbars Kitchen', url: `https://hebbarskitchen.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://hebbarskitchen.com', 'Hebbars Kitchen') },
    ];

    const allResults = [];

    await Promise.all(sources.map(async (s) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(s.url, {
          headers: { 'User-Agent': userAgent },
          signal: controller.signal
        });
        clearTimeout(timeout);
        const html = await response.text();
        const items = s.parser(html);
        for (const item of items.slice(0, 5)) {
          allResults.push(item);
        }
      } catch {}
    }));

    res.json(allResults);
  } catch (err) {
    console.error('rezept suche error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/rezept/zutaten', requireAuth, async (req, res) => {
  try {
    const url = req.query.url || '';
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'URL nicht erlaubt.' });
    }

    if ((parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') ||
        !allowedRecipeHosts.has(parsedUrl.hostname)) {
      return res.status(400).json({ error: 'URL nicht erlaubt.' });
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await response.text();

    const zutaten = [];

    // Try JSON-LD first
    const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;
    let jm;
    while ((jm = jsonLdPattern.exec(html)) !== null) {
      try {
        const doc = JSON.parse(jm[1]);
        if (doc.recipeIngredient) {
          for (const ing of doc.recipeIngredient) {
            const text = (ing || '').trim();
            if (!text) continue;
            parseZutat(text, zutaten);
          }
          return res.json(zutaten);
        }
      } catch {}
    }

    // Fallback: parse HTML for ingredient patterns
    const ingPattern = /(\d+[\.,]?\d*)\s*(g|kg|ml|dl|l|EL|TL|Stück|Prise|Bund|Packung|Pack\.)?\s+(.+?)(?:<|$)/gi;
    let im;
    while ((im = ingPattern.exec(html)) !== null) {
      const mengeStr = im[1].replace(',', '.');
      const menge = parseFloat(mengeStr) || 1;
      const einheit = im[2] || 'Stück';
      const artikel = decodeHTMLEntities(im[3].trim());
      zutaten.push({ menge, einheit, artikel });
    }

    res.json(zutaten);
  } catch (err) {
    console.error('rezept zutaten error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== FAVORITEN ENDPOINTS ====================

app.get('/api/favoriten', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request();
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT Id, Name, Url, Quelle, EigenGerichtId FROM Favorit WHERE ${where} ORDER BY Name`);
    res.json(result.recordset.map(r => ({
      id: r.Id,
      name: r.Name,
      url: r.Url || null,
      quelle: r.Quelle || null,
      eigenGerichtId: r.EigenGerichtId || null
    })));
  } catch (err) {
    console.error('favoriten get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/favoriten', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const name = (req.body.name || '').trim();
    if (name.length < 1) return res.status(400).json({ error: 'Name ist erforderlich.' });

    const url = req.body.url ? req.body.url.trim() : null;
    const quelle = req.body.quelle ? req.body.quelle.trim() : null;
    const eigenGerichtId = (req.body.eigenGerichtId != null && typeof req.body.eigenGerichtId === 'number') ? req.body.eigenGerichtId : null;

    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    // Check duplicate
    const whereCheck = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    let dupSql;
    if (url) {
      dupSql = `SELECT COUNT(*) AS cnt FROM Favorit WHERE ${whereCheck} AND Url=@url`;
    } else if (eigenGerichtId != null) {
      dupSql = `SELECT COUNT(*) AS cnt FROM Favorit WHERE ${whereCheck} AND EigenGerichtId=@eid`;
    } else {
      dupSql = `SELECT COUNT(*) AS cnt FROM Favorit WHERE ${whereCheck} AND Name=@name AND Url IS NULL AND EigenGerichtId IS NULL`;
    }

    const dupRequest = db.request();
    if (hid != null) dupRequest.input('hid', sql.Int, hid);
    else dupRequest.input('uid', sql.Int, userId);
    if (url) dupRequest.input('url', sql.NVarChar, url);
    if (eigenGerichtId != null) dupRequest.input('eid', sql.Int, eigenGerichtId);
    dupRequest.input('name', sql.NVarChar, name);

    const dupResult = await dupRequest.query(dupSql);
    if (dupResult.recordset[0].cnt > 0) return res.json({ duplicate: true });

    const result = await db.request()
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .input('name', sql.NVarChar, name)
      .input('url', sql.NVarChar, url)
      .input('quelle', sql.NVarChar, quelle)
      .input('eid', sql.Int, eigenGerichtId)
      .query('INSERT INTO Favorit (BenutzerId, HaushaltId, Name, Url, Quelle, EigenGerichtId) OUTPUT INSERTED.Id VALUES (@uid, @hid, @name, @url, @quelle, @eid)');
    res.json({ id: result.recordset[0].Id });
  } catch (err) {
    console.error('favoriten post error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.delete('/api/favoriten/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`DELETE FROM Favorit WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({});
  } catch (err) {
    console.error('favoriten delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== AKTIONEN (PROMOTIONS) ====================

const AKTIONEN_CACHE = {
  data: [],
  lastFetch: 0,
  ttlMs: 4 * 60 * 60 * 1000 // 4 hours
};

const AKTIONEN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchAllAktionen() {
  const now = Date.now();
  if (AKTIONEN_CACHE.data.length > 0 && (now - AKTIONEN_CACHE.lastFetch) < AKTIONEN_CACHE.ttlMs) {
    return AKTIONEN_CACHE.data;
  }

  console.log('Aktionen: Fetching promotions from all stores...');
  const results = [];

  const fetchers = [
    fetchDennerAktionenAPI,
    fetchAktionisDeals,
  ];

  await Promise.all(fetchers.map(async (fn) => {
    try {
      const items = await fn();
      results.push(...items);
    } catch (e) {
      console.error(`Aktionen: ${fn.name} failed:`, e.message);
    }
  }));

  AKTIONEN_CACHE.data = results;
  AKTIONEN_CACHE.lastFetch = now;
  console.log(`Aktionen: ${results.length} promotions cached`);
  return results;
}

// --- Denner (official Mobile API, no auth required) ---
async function fetchDennerAktionenAPI() {
  const items = [];
  try {
    // Step 1: Get filter IDs (promotion categories)
    const controller1 = new AbortController();
    const timeout1 = setTimeout(() => controller1.abort(), 10000);
    const filtersRes = await fetch('https://denner-mobile-api.detailnet.ch/v2/online-filters', {
      headers: { 'Accept': 'application/json', 'Accept-Language': 'de' },
      signal: controller1.signal
    });
    clearTimeout(timeout1);
    if (!filtersRes.ok) throw new Error(`Denner filters: ${filtersRes.status}`);
    const filtersData = await filtersRes.json();
    const filters = (filtersData.online_filters || []).filter(f =>
      !f.title.toLowerCase().includes('tabak')
    );

    // Step 2: Fetch articles for each filter
    await Promise.all(filters.map(async (filter) => {
      try {
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 15000);
        const pubRes = await fetch(
          `https://denner-mobile-api.detailnet.ch/v2/online-filters/${filter.id}/online-publications`,
          {
            headers: { 'Accept': 'application/json', 'Accept-Language': 'de' },
            signal: controller2.signal
          }
        );
        clearTimeout(timeout2);
        if (!pubRes.ok) return;
        const pubData = await pubRes.json();

        for (const pub of (pubData.online_publications || [])) {
          for (const article of (pub.articles || [])) {
            const prices = article.prices || {};
            items.push({
              name: article.title || '',
              beschreibung: article.description || '',
              preis: prices.sales || null,
              originalPreis: prices.instead || null,
              rabatt: article.stopper?.text || null,
              laden: 'Denner',
              kategorie: filter.title,
              gueltigVon: article.validity?.from || null,
              gueltigBis: article.validity?.to || null,
              bild: article.packshot?.cdn_url || null,
              url: null
            });
          }
        }
      } catch (e) {
        console.error(`Aktionen Denner filter ${filter.title}:`, e.message);
      }
    }));
  } catch (e) {
    console.error('Aktionen Denner API:', e.message);
  }
  console.log(`Aktionen Denner: ${items.length} articles`);
  return items;
}

// --- Aktionis.ch (HTML scraping, covers Migros/Coop/Lidl/Aldi/etc.) ---
async function fetchAktionisDeals() {
  const items = [];
  const vendors = [
    { slug: 'migros', laden: 'Migros' },
    { slug: 'coop', laden: 'Coop' },
    { slug: 'coop-megastore', laden: 'Coop Megastore' },
    { slug: 'lidl', laden: 'Lidl' },
    { slug: 'aldi-suisse', laden: 'Aldi' },
    { slug: 'denner', laden: 'Denner' },
    { slug: 'otto-s', laden: "OTTO'S" },
    { slug: 'spar', laden: 'SPAR' },
    { slug: 'volg', laden: 'Volg' },
  ];

  await Promise.all(vendors.map(async ({ slug, laden }) => {
    try {
      // Fetch first 2 pages per vendor
      for (let page = 1; page <= 2; page++) {
        const url = page === 1
          ? `https://www.aktionis.ch/vendors/${slug}`
          : `https://www.aktionis.ch/vendors/${slug}?page=${page}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
          headers: { 'User-Agent': AKTIONEN_UA, 'Accept': 'text/html' },
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) break;
        const html = await res.text();

        // Parse deal cards - look for common patterns
        // Aktionis uses deal cards with price, discount, product name
        const dealPattern = /<a[^>]*class="[^"]*deal[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let dm;
        while ((dm = dealPattern.exec(html)) !== null && items.length < 500) {
          const block = dm[2];
          const dealUrl = dm[1];

          // Extract product name
          const nameMatch = block.match(/<(?:h[2-5]|span|div|p)[^>]*class="[^"]*(?:title|name|heading)[^"]*"[^>]*>([^<]{3,120})/i)
            || block.match(/<h[2-5][^>]*>([^<]{3,120})<\/h[2-5]>/i);

          // Extract prices
          const priceMatch = block.match(/(?:class="[^"]*(?:new|sale|current)[^"]*"[^>]*>)[^<]*?(\d+\.\d{2})/i)
            || block.match(/(\d+\.\d{2})/);
          const oldPriceMatch = block.match(/(?:class="[^"]*(?:old|original|strike|was)[^"]*"[^>]*>)[^<]*?(\d+\.\d{2})/i)
            || block.match(/(?:statt|alt|was)\s*(?:CHF\s*)?(\d+\.\d{2})/i);

          // Extract discount percentage
          const discountMatch = block.match(/(-?\d+)\s*%/);

          if (nameMatch) {
            const name = decodeHTMLEntities(nameMatch[1].trim());
            if (name.length > 2) {
              items.push({
                name,
                beschreibung: '',
                preis: priceMatch ? parseFloat(priceMatch[1]) : null,
                originalPreis: oldPriceMatch ? parseFloat(oldPriceMatch[1]) : null,
                rabatt: discountMatch ? `${discountMatch[1]}%` : null,
                laden,
                kategorie: null,
                gueltigVon: null,
                gueltigBis: null,
                bild: null,
                url: dealUrl ? (dealUrl.startsWith('http') ? dealUrl : `https://www.aktionis.ch${dealUrl}`) : null
              });
            }
          }
        }

        // Alternative: try broader card patterns if deal-class pattern didn't match
        if (items.filter(i => i.laden === laden).length === 0) {
          const cardPattern = /<div[^>]*class="[^"]*card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
          let cm;
          while ((cm = cardPattern.exec(html)) !== null && items.length < 500) {
            const block = cm[1];
            const nameMatch = block.match(/<(?:h[2-5]|span|strong)[^>]*>([^<]{3,100})<\//i);
            const priceMatch = block.match(/(\d+\.\d{2})/);
            const discountMatch = block.match(/(-?\d+)\s*%/);

            if (nameMatch && (priceMatch || discountMatch)) {
              const name = decodeHTMLEntities(nameMatch[1].trim());
              if (name.length > 2 && !/^\d/.test(name)) {
                items.push({
                  name,
                  beschreibung: '',
                  preis: priceMatch ? parseFloat(priceMatch[1]) : null,
                  originalPreis: null,
                  rabatt: discountMatch ? `${discountMatch[1]}%` : null,
                  laden,
                  kategorie: null,
                  gueltigVon: null,
                  gueltigBis: null,
                  bild: null,
                  url: null
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`Aktionen Aktionis ${laden}:`, e.message);
    }
  }));

  console.log(`Aktionen Aktionis.ch: ${items.length} deals (${vendors.map(v => `${v.laden}: ${items.filter(i => i.laden === v.laden).length}`).join(', ')})`);
  return items;
}

// --- Matching ---
function matchAktion(artikelName, aktionen) {
  if (!artikelName || artikelName.length < 2) return [];
  const searchTerms = artikelName.toLowerCase()
    .replace(/[äöü]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue' }[c]))
    .split(/\s+/)
    .filter(t => t.length > 2);
  const searchLower = artikelName.toLowerCase();

  return aktionen.filter(a => {
    const name = a.name.toLowerCase();
    // Exact substring match
    if (name.includes(searchLower)) return true;
    // All significant search terms found
    if (searchTerms.length > 0 && searchTerms.every(t => name.includes(t))) return true;
    // Reverse: promotion name terms found in search
    const aktionTerms = name.split(/\s+/).filter(t => t.length > 2);
    if (aktionTerms.some(t => searchLower.includes(t) && t.length > 3)) return true;
    return false;
  }).slice(0, 5);
}

// --- API Endpoints ---
app.get('/api/aktionen', requireAuth, async (req, res) => {
  try {
    const suche = (req.query.suche || '').trim();
    const laden = (req.query.laden || '').trim();
    const aktionen = await fetchAllAktionen();

    let filtered = aktionen;
    if (suche) {
      filtered = matchAktion(suche, filtered);
    }
    if (laden) {
      filtered = filtered.filter(a => a.laden.toLowerCase() === laden.toLowerCase());
    }
    res.json(filtered.slice(0, 50));
  } catch (err) {
    console.error('aktionen error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/aktionen/match', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    let artikelResult;
    if (hid != null) {
      artikelResult = await db.request()
        .input('hid', sql.Int, hid)
        .query('SELECT Id, Artikel FROM Artikel WHERE HaushaltId=@hid AND Gekauft=0');
    } else {
      artikelResult = await db.request()
        .input('uid', sql.Int, userId)
        .query('SELECT Id, Artikel FROM Artikel WHERE BenutzerId=@uid AND HaushaltId IS NULL AND Gekauft=0');
    }

    const aktionen = await fetchAllAktionen();
    const matches = {};

    for (const row of artikelResult.recordset) {
      const found = matchAktion(row.Artikel, aktionen);
      if (found.length > 0) {
        matches[row.Id] = found;
      }
    }

    res.json(matches);
  } catch (err) {
    console.error('aktionen match error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.get('/api/aktionen/alle', requireAuth, async (req, res) => {
  try {
    const aktionen = await fetchAllAktionen();
    const byLaden = {};
    for (const a of aktionen) {
      if (!byLaden[a.laden]) byLaden[a.laden] = [];
      byLaden[a.laden].push(a);
    }
    res.json({ total: aktionen.length, byLaden });
  } catch (err) {
    console.error('aktionen alle error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

app.post('/api/aktionen/refresh', requireAuth, async (req, res) => {
  try {
    AKTIONEN_CACHE.lastFetch = 0;
    const aktionen = await fetchAllAktionen();
    res.json({ total: aktionen.length });
  } catch (err) {
    console.error('aktionen refresh error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// ==================== STARTUP ====================

async function startup() {
  try {
    const db = await getPool();

    // Ensure all base tables exist
    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Benutzer')
      CREATE TABLE Benutzer (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Benutzername NVARCHAR(200) NOT NULL UNIQUE,
          PasswordHash NVARCHAR(500) NOT NULL,
          Email NVARCHAR(300) NULL,
          EmailBestaetigt BIT NOT NULL DEFAULT 0,
          AktivierungsToken NVARCHAR(200) NULL,
          ResetToken NVARCHAR(200) NULL,
          ResetTokenExpiry DATETIME2 NULL,
          IsAdmin BIT NOT NULL DEFAULT 0,
          HaushaltId INT NULL,
          HaushaltRolle NVARCHAR(20) NOT NULL DEFAULT 'schreibend',
          ErstelltAm DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Haushalt')
      CREATE TABLE Haushalt (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Name NVARCHAR(200) NOT NULL,
          Code NVARCHAR(20) NOT NULL UNIQUE,
          ErstelltVon INT NULL,
          ErstelltAm DATETIME2 NOT NULL DEFAULT GETUTCDATE()
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Laden')
      CREATE TABLE Laden (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Name NVARCHAR(200) NOT NULL,
          Sortierung INT NOT NULL DEFAULT 0
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Artikel')
      CREATE TABLE Artikel (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Artikel NVARCHAR(300) NOT NULL,
          Menge DECIMAL(18,2) NOT NULL DEFAULT 1,
          Einheit NVARCHAR(50) NOT NULL DEFAULT 'Stück',
          Laden NVARCHAR(200) NULL,
          Datum DATETIME2 NULL,
          Gekauft BIT NOT NULL DEFAULT 0,
          BenutzerId INT NOT NULL,
          HaushaltId INT NULL,
          ErstelltAm DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
          FOREIGN KEY (BenutzerId) REFERENCES Benutzer(Id)
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Gericht')
      CREATE TABLE Gericht (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Name NVARCHAR(300) NOT NULL,
          BenutzerId INT NOT NULL,
          HaushaltId INT NULL,
          ErstelltAm DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
          FOREIGN KEY (BenutzerId) REFERENCES Benutzer(Id)
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='GerichtZutat')
      CREATE TABLE GerichtZutat (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          GerichtId INT NOT NULL,
          Artikel NVARCHAR(300) NOT NULL,
          Menge DECIMAL(18,2) NOT NULL DEFAULT 1,
          Einheit NVARCHAR(50) NOT NULL DEFAULT 'Stück',
          FOREIGN KEY (GerichtId) REFERENCES Gericht(Id)
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Wochenplan')
      CREATE TABLE Wochenplan (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Woche DATETIME2 NOT NULL,
          Tag INT NOT NULL,
          Mahlzeit NVARCHAR(100) NOT NULL,
          Rezept NVARCHAR(500) NULL,
          Erwachsene INT NOT NULL DEFAULT 2,
          Kinder INT NOT NULL DEFAULT 0,
          BenutzerId INT NOT NULL,
          HaushaltId INT NULL,
          FOREIGN KEY (BenutzerId) REFERENCES Benutzer(Id)
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Favorit')
      CREATE TABLE Favorit (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          BenutzerId INT NOT NULL,
          HaushaltId INT NULL,
          Name NVARCHAR(300) NOT NULL,
          Url NVARCHAR(1000) NULL,
          Quelle NVARCHAR(100) NULL,
          EigenGerichtId INT NULL,
          ErstelltAm DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
          FOREIGN KEY (BenutzerId) REFERENCES Benutzer(Id)
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='WebAuthnCredential')
      CREATE TABLE WebAuthnCredential (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          BenutzerId INT NOT NULL,
          CredentialId NVARCHAR(2048) NOT NULL,
          CredentialIdHash AS HASHBYTES('SHA2_256', CredentialId) PERSISTED,
          PublicKey VARBINARY(MAX) NOT NULL,
          Counter INT NOT NULL DEFAULT 0,
          Geraetename NVARCHAR(100) NOT NULL,
          Transports NVARCHAR(500) NULL,
          ErstelltAm DATETIME2 NOT NULL DEFAULT GETDATE(),
          CONSTRAINT FK_WebAuthnCredential_Benutzer FOREIGN KEY (BenutzerId)
              REFERENCES Benutzer(Id) ON DELETE CASCADE
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='UQ_WebAuthnCredential_CredentialIdHash')
      CREATE UNIQUE INDEX UQ_WebAuthnCredential_CredentialIdHash
          ON WebAuthnCredential(CredentialIdHash)`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_WebAuthnCredential_BenutzerId')
      CREATE INDEX IX_WebAuthnCredential_BenutzerId
          ON WebAuthnCredential(BenutzerId)`);

    // Ensure HaushaltRolle column on Benutzer (for existing databases)
    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('Benutzer') AND name='HaushaltRolle')
      ALTER TABLE Benutzer ADD HaushaltRolle NVARCHAR(20) NOT NULL DEFAULT 'schreibend'`);

    // Ensure ErstelltVon column on Haushalt (for existing databases)
    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('Haushalt') AND name='ErstelltVon')
      ALTER TABLE Haushalt ADD ErstelltVon INT NULL`);

    // Seed or update Admin
    if (adminPassword && adminPassword.length >= 8) {
      const check = await db.request().query("SELECT COUNT(*) AS cnt FROM Benutzer WHERE Benutzername='Admin'");
      if (check.recordset[0].cnt === 0) {
        await db.request()
          .input('hash', sql.NVarChar, hashPassword(adminPassword))
          .query("INSERT INTO Benutzer (Benutzername, PasswordHash, EmailBestaetigt, IsAdmin) VALUES ('Admin', @hash, 1, 1)");
        console.log('Admin-Benutzer erstellt');
      } else {
        await db.request()
          .input('hash', sql.NVarChar, hashPassword(adminPassword))
          .query("UPDATE Benutzer SET PasswordHash=@hash WHERE Benutzername='Admin'");
        console.log('Admin-Passwort aktualisiert');
      }
    }

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Startup error:', err);
    try {
      const logPath = path.join(__dirname, 'startup-error.txt');
      fs.writeFileSync(logPath, `${new Date().toISOString()}\n${err.stack || err}`);
    } catch { /* ignore write errors */ }
  }
}

// Start server immediately, then initialize DB in background
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startup();
});
