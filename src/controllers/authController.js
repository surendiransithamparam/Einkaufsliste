const crypto = require('crypto');
const { getPool, sql } = require('../config/db');
const { hashPassword, verifyPassword } = require('../utils/crypto');
const { validatePassword } = require('../utils/validation');
const { sendActivationEmail, sendResetEmail } = require('../utils/email');
const { isRateLimited } = require('../middleware/rateLimit');

async function register(req, res) {
  try {
    if (isRateLimited(req, 'register', 5, 300))
      return res.status(429).json({ error: 'Zu viele Versuche. Bitte warte einige Minuten.' });

    const { benutzername, passwort, email } = req.body;
    const username = (benutzername || '').trim();
    const password = passwort || '';
    const emailAddr = (email || '').trim();

    if (username.length < 2) return res.status(400).json({ error: 'Benutzername muss mindestens 2 Zeichen haben.' });
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });
    if (emailAddr.length < 5 || !emailAddr.includes('@')) return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });

    const db = await getPool();

    const check = await db.request()
      .input('name', sql.NVarChar, username)
      .query('SELECT COUNT(*) AS cnt FROM Benutzer WHERE Benutzername=@name');
    if (check.recordset[0].cnt > 0)
      return res.status(409).json({ error: 'Benutzername ist bereits vergeben.' });

    const token = crypto.randomBytes(32).toString('base64url');

    await db.request()
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
}

async function login(req, res) {
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
}

async function activate(req, res) {
  try {
    const token = req.query.token || '';
    const db = await getPool();
    const result = await db.request()
      .input('token', sql.NVarChar, token)
      .query('UPDATE Benutzer SET EmailBestaetigt=1, AktivierungsToken=NULL WHERE AktivierungsToken=@token AND EmailBestaetigt=0');

    const htmlOk = '<html><body style="font-family:sans-serif;text-align:center;padding:3rem"><h2 style="color:#22c55e">&#10003; E-Mail bestätigt!</h2><p>Dein Konto ist jetzt aktiv. Du kannst dich anmelden.</p><a href="/">Zur Haushalt⁺</a></body></html>';
    const htmlFail = '<html><body style="font-family:sans-serif;text-align:center;padding:3rem"><h2 style="color:#ef4444">Link ungültig</h2><p>Dieser Aktivierungslink ist ungültig oder wurde bereits verwendet.</p><a href="/">Zur Haushalt⁺</a></body></html>';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rowsAffected[0] > 0 ? htmlOk : htmlFail);
  } catch (err) {
    console.error('aktivieren error:', err);
    res.status(500).send('Fehler');
  }
}

async function resendActivation(req, res) {
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
}

async function requestReset(req, res) {
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
        await sendResetEmail(email, row.Benutzername, token, req);
    } catch (ex) {
      console.error('Reset-Mail konnte nicht gesendet werden', ex);
    }

    res.json({ message: genericMsg });
  } catch (err) {
    console.error('reset-request error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function performReset(req, res) {
  try {
    const token = (req.body.token || '').trim();
    const password = req.body.passwort || '';

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

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
}

async function logout(req, res) {
    req.session.destroy(() => {
        res.clearCookie('einkauf_auth');
        res.json({});
    });
}

async function getMe(req, res) {
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
}

async function updateProfile(req, res) {
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
}

async function changePassword(req, res) {
    try {
        const userId = req.session.userId;
        const oldPassword = req.body.altesPasswort || '';
        const newPassword = req.body.neuesPasswort || '';
    
        const pwError = validatePassword(newPassword);
        if (pwError) return res.status(400).json({ error: pwError });
    
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
}

module.exports = {
  register,
  login,
  activate,
  resendActivation,
  requestReset,
  performReset,
  logout,
  getMe,
  updateProfile,
  changePassword
};
