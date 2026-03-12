# WebAuthn/FIDO2 Biometric Login Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fingerprint/Face ID login to the Einkaufsliste PWA using WebAuthn/FIDO2.

**Architecture:** New WebAuthn endpoints in server.js alongside existing auth routes. Client-side logic in a new `public/webauthn.js` file using vendored `@simplewebauthn/browser` bundle. Credentials stored in new SQL Server table with hash-based unique index.

**Tech Stack:** `@simplewebauthn/server` (backend), `@simplewebauthn/browser` (frontend, vendored UMD), SQL Server, Express.js sessions

**Spec:** `docs/superpowers/specs/2026-03-12-webauthn-biometric-login-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server.js` | Modify | Add 6 WebAuthn API endpoints + config loading |
| `public/webauthn.js` | Create | Client-side WebAuthn logic (registration, authentication, device management) |
| `public/index.html` | Modify | Add biometric login button, after-login prompt modal, profile device section |
| `public/shared.js` | Modify | Hook WebAuthn prompt into login flow |
| `public/lib/simplewebauthn-browser.min.js` | Create | Vendored UMD bundle of @simplewebauthn/browser |
| `public/sw.js` | Modify | Add new files to service worker cache |
| `package.json` | Modify | Add @simplewebauthn/server dependency |
| `sql/create-webauthn-table.sql` | Create | Database migration script |

---

## Chunk 1: Backend Foundation

### Task 1: Database Migration Script

**Files:**
- Create: `sql/create-webauthn-table.sql`

- [ ] **Step 1: Create the SQL migration file**

```sql
-- WebAuthn/FIDO2 Credential Storage
-- Run this against the Einkaufsliste database before deploying WebAuthn feature

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
    CONSTRAINT FK_WebAuthnCredential_Benutzer FOREIGN KEY (BenutzerId) REFERENCES Benutzer(Id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX UQ_WebAuthnCredential_CredentialIdHash ON WebAuthnCredential(CredentialIdHash);
CREATE INDEX IX_WebAuthnCredential_BenutzerId ON WebAuthnCredential(BenutzerId);
```

- [ ] **Step 2: Run migration against database**

Run the SQL script against the target database. Verify with:
```sql
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'WebAuthnCredential';
```
Expected: One row returned.

- [ ] **Step 3: Commit**

```bash
git add sql/create-webauthn-table.sql
git commit -m "feat(webauthn): add WebAuthnCredential table migration script"
```

---

### Task 2: Install Backend Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @simplewebauthn/server**

```bash
npm install @simplewebauthn/server
```

- [ ] **Step 2: Verify installation**

```bash
node -e "const s = require('@simplewebauthn/server'); console.log(Object.keys(s));"
```
Expected: Array containing `generateRegistrationOptions`, `verifyRegistrationResponse`, `generateAuthenticationOptions`, `verifyAuthenticationResponse`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(webauthn): add @simplewebauthn/server dependency"
```

---

### Task 3: WebAuthn Config Loading

**Files:**
- Modify: `server.js` (after line 24, config section)

- [ ] **Step 1: Add WebAuthn config after existing config loading (after line 24 in server.js)**

Add after the existing `const githubConfig = ...` block (around line 24):

```javascript
// WebAuthn / FIDO2 Konfiguration
const webauthnConfig = {
  rpID: process.env.WEBAUTHN_RP_ID || (config.webauthn && config.webauthn.rpId) || 'localhost',
  rpName: process.env.WEBAUTHN_RP_NAME || (config.webauthn && config.webauthn.rpName) || 'Einkaufsliste',
  origin: process.env.WEBAUTHN_ORIGIN || (config.webauthn && config.webauthn.origin) || 'http://localhost:3000'
};
```

- [ ] **Step 2: Add require for @simplewebauthn/server at top of server.js (after line 7)**

```javascript
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
```

- [ ] **Step 3: Verify server starts without errors**

```bash
node server.js
```
Expected: Server starts normally. Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(webauthn): add WebAuthn config and imports"
```

---

### Task 4: Registration Endpoints (register-options + register-verify)

**Files:**
- Modify: `server.js` (add after auth endpoints, around line 860)

- [ ] **Step 1: Add POST /api/webauthn/register-options endpoint**

Add after the existing auth endpoints (after the change-password endpoint around line 860):

```javascript
// ── WebAuthn / FIDO2 Endpoints ──────────────────────────────────────

app.post('/api/webauthn/register-options', requireAuth, async (req, res) => {
  try {
    if (isRateLimited(req, 'webauthn_register', 5, 300)) return res.status(429).json({ error: 'Zu viele Versuche.' });
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

    const options = await generateRegistrationOptions({
      rpName: webauthnConfig.rpName,
      rpID: webauthnConfig.rpID,
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
```

- [ ] **Step 2: Add POST /api/webauthn/register-verify endpoint**

Add directly after register-options:

```javascript
app.post('/api/webauthn/register-verify', requireAuth, async (req, res) => {
  try {
    const challengeData = req.session.webauthnChallenge;
    if (!challengeData) return res.status(400).json({ error: 'Keine Challenge vorhanden.' });
    if (Date.now() > challengeData.expires) {
      delete req.session.webauthnChallenge;
      return res.status(400).json({ error: 'Challenge abgelaufen. Bitte erneut versuchen.' });
    }

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: webauthnConfig.origin,
      expectedRPID: webauthnConfig.rpID
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
```

- [ ] **Step 3: Verify server starts**

```bash
node server.js
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(webauthn): add registration endpoints (options + verify)"
```

---

### Task 5: Authentication Endpoints (login-options + login-verify)

**Files:**
- Modify: `server.js` (add after registration endpoints)

- [ ] **Step 1: Add POST /api/webauthn/login-options endpoint**

```javascript
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

    const options = await generateAuthenticationOptions({
      rpID: webauthnConfig.rpID,
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
```

- [ ] **Step 2: Add POST /api/webauthn/login-verify endpoint**

```javascript
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

    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: webauthnConfig.origin,
      expectedRPID: webauthnConfig.rpID,
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
```

- [ ] **Step 3: Verify server starts**

```bash
node server.js
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(webauthn): add authentication endpoints (login-options + login-verify)"
```

---

### Task 6: Credential Management Endpoints (list + delete)

**Files:**
- Modify: `server.js` (add after login-verify)

- [ ] **Step 1: Add GET /api/webauthn/credentials endpoint**

```javascript
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
```

- [ ] **Step 2: Add DELETE /api/webauthn/credentials/:id endpoint**

```javascript
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
```

- [ ] **Step 3: Verify server starts**

```bash
node server.js
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(webauthn): add credential management endpoints (list + delete)"
```

---

## Chunk 2: Frontend

### Task 7: Vendor @simplewebauthn/browser Bundle

**Files:**
- Create: `public/lib/simplewebauthn-browser.min.js`

- [ ] **Step 1: Install @simplewebauthn/browser temporarily and copy the UMD bundle**

```bash
cd /c/Temp/github/Einkaufsliste
npm install @simplewebauthn/browser
```

Then find and copy the bundle:

```bash
mkdir -p public/lib
cp node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js public/lib/simplewebauthn-browser.min.js
```

If the UMD bundle path differs, look for it:
```bash
find node_modules/@simplewebauthn/browser -name "*.umd*" -o -name "*.min.js" | head -5
```

If no UMD bundle exists, use the ES module approach instead — create a small wrapper:
```bash
cp node_modules/@simplewebauthn/browser/dist/bundle/index.js public/lib/simplewebauthn-browser.js
```

- [ ] **Step 2: Remove @simplewebauthn/browser from dependencies (only needed at build time)**

```bash
npm uninstall @simplewebauthn/browser
```

- [ ] **Step 3: Verify the file is present and non-empty**

```bash
ls -la public/lib/simplewebauthn-browser*.js
```

- [ ] **Step 4: Commit**

```bash
git add public/lib/
git commit -m "feat(webauthn): vendor @simplewebauthn/browser client bundle"
```

---

### Task 8: Create webauthn.js Client Logic

**Files:**
- Create: `public/webauthn.js`

- [ ] **Step 1: Create public/webauthn.js with all WebAuthn client functions**

```javascript
// WebAuthn / FIDO2 Client-Logik
// Nutzt @simplewebauthn/browser (geladen als UMD-Bundle via <script>)

const WebAuthnClient = {
  // Prüft ob WebAuthn vom Browser unterstützt wird
  async istVerfuegbar() {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
      return false;
    }
  },

  // Registrierung: Biometrie einrichten
  async starteRegistrierung(geraetename) {
    const optRes = await fetch('/api/webauthn/register-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geraetename })
    });
    if (!optRes.ok) {
      const err = await optRes.json();
      throw new Error(err.error || 'Fehler beim Starten der Registrierung.');
    }
    const options = await optRes.json();

    // Browser-Dialog: Fingerabdruck / Face ID
    const attResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });

    const verifyRes = await fetch('/api/webauthn/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attResp)
    });
    if (!verifyRes.ok) {
      const err = await verifyRes.json();
      throw new Error(err.error || 'Verifizierung fehlgeschlagen.');
    }
    return await verifyRes.json();
  },

  // Anmeldung: Biometrischer Login
  async starteAnmeldung(benutzername) {
    const optRes = await fetch('/api/webauthn/login-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ benutzername })
    });
    if (!optRes.ok) {
      const err = await optRes.json();
      throw new Error(err.error || 'Fehler beim Starten der Anmeldung.');
    }
    const options = await optRes.json();

    // Browser-Dialog: Fingerabdruck / Face ID
    const authResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });

    const verifyRes = await fetch('/api/webauthn/login-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authResp)
    });
    if (!verifyRes.ok) {
      const err = await verifyRes.json();
      if (verifyRes.status === 403) throw new Error('Konto nicht aktiviert.');
      throw new Error(err.error || 'Anmeldung fehlgeschlagen.');
    }
    return await verifyRes.json();
  },

  // Geräteliste laden
  async ladeGeraete() {
    const res = await fetch('/api/webauthn/credentials');
    if (!res.ok) throw new Error('Fehler beim Laden der Geräte.');
    return await res.json();
  },

  // Gerät entfernen
  async loescheGeraet(id) {
    const res = await fetch(`/api/webauthn/credentials/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Entfernen des Geräts.');
    return await res.json();
  },

  // Prüft ob Prompt angezeigt werden soll (localStorage-basiert)
  // Nutzt benutzername als Key, da currentUser nach Login kein id-Feld hat
  sollPromptZeigen(benutzername) {
    if (localStorage.getItem(`webauthn_registered_${benutzername}`)) return false;
    const dismissed = localStorage.getItem(`webauthn_dismissed_${benutzername}`);
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      const dreissigTage = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - dismissedAt < dreissigTage) return false;
    }
    return true;
  },

  // Markiert dass dieses Gerät registriert wurde
  markiereRegistriert(benutzername) {
    localStorage.setItem(`webauthn_registered_${benutzername}`, 'true');
  },

  // Markiert dass Prompt abgelehnt wurde
  markiereAbgelehnt(benutzername) {
    localStorage.setItem(`webauthn_dismissed_${benutzername}`, Date.now().toString());
  }
};
```

- [ ] **Step 2: Verify syntax**

```bash
node -c public/webauthn.js
```
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
git add public/webauthn.js
git commit -m "feat(webauthn): add client-side WebAuthn logic"
```

---

### Task 9: Add Biometric Login Button to Login Page

**Files:**
- Modify: `public/index.html` (login form around line 340-368, script tags around line 373-375)

- [ ] **Step 1: Add script tags for WebAuthn libraries before existing scripts (before line 373)**

Find the script loading section at the bottom of index.html (around line 373):
```html
<script src="shared.js"></script>
```

Add BEFORE it:
```html
<script src="lib/simplewebauthn-browser.min.js"></script>
<script src="webauthn.js"></script>
```

So the order becomes:
```html
<script src="lib/simplewebauthn-browser.min.js"></script>
<script src="webauthn.js"></script>
<script src="shared.js"></script>
<script src="bugreport.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 2: Add biometric login button to login form**

Find the login form submit button (around line 360):
```html
<button type="submit" class="btn btn-primary" style="width:100%;">
  <i class="bi bi-box-arrow-in-right"></i> Anmelden
</button>
```

Add AFTER it (before the register link):
```html
<button type="button" id="webauthnLoginBtn" class="btn btn-secondary" style="width:100%;display:none;" onclick="webauthnLogin()">
  <i class="bi bi-fingerprint"></i> Mit Biometrie anmelden
</button>
```

- [ ] **Step 3: Add WebAuthn setup prompt modal**

Find the end of the `<body>` tag. Add BEFORE the script tags:

```html
<!-- WebAuthn Setup Prompt -->
<div class="modal-overlay" id="webauthnPromptOverlay" style="display:none;">
  <div class="modal" style="max-width:400px">
    <div class="modal-header">
      <h2><i class="bi bi-fingerprint"></i> Biometrie einrichten</h2>
      <button class="modal-close" onclick="webauthnPromptAblehnen()">&times;</button>
    </div>
    <div class="modal-body">
      <p>Möchtest du beim nächsten Mal Fingerabdruck oder Face ID zum Anmelden nutzen?</p>
      <div style="margin-bottom:12px;">
        <label for="webauthnGeraetename">Gerätename</label>
        <input type="text" id="webauthnGeraetename" placeholder="z.B. Mein iPhone" maxlength="100">
      </div>
      <div id="webauthnPromptError" style="display:none;color:var(--red-500);margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" style="flex:1;" onclick="webauthnPromptAnnehmen()">
          <i class="bi bi-fingerprint"></i> Ja, einrichten
        </button>
        <button class="btn btn-secondary" style="flex:1;" onclick="webauthnPromptAblehnen()">
          Später
        </button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(webauthn): add biometric login button and setup prompt to login page"
```

---

### Task 10: Add WebAuthn Device Management to Profile

**Files:**
- Modify: `public/index.html` (profile modal around line 258-306)

- [ ] **Step 1: Add biometric device section to profile modal**

Find the password change section ending in the profile modal. Look for the last `</button>` inside the modal-body of `#profilOverlay` (around line 304). Add AFTER the password change button but still inside `modal-body`:

```html
<!-- Biometrische Anmeldung -->
<hr style="margin:16px 0;">
<h3><i class="bi bi-fingerprint"></i> Biometrische Anmeldung</h3>
<div id="webauthnGeraeteSection" style="display:none;">
  <div id="webauthnGeraeteListe"></div>
  <button class="btn btn-secondary" style="width:100%;margin-top:8px;" onclick="webauthnNeuesGeraet()">
    <i class="bi bi-plus-circle"></i> Neues Gerät hinzufügen
  </button>
</div>
<div id="webauthnNichtVerfuegbar" style="display:none;color:var(--text-muted);">
  <p>Biometrische Anmeldung wird von diesem Browser nicht unterstützt.</p>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat(webauthn): add device management section to profile modal"
```

---

### Task 11: Wire Up WebAuthn Logic in shared.js

**Files:**
- Modify: `public/shared.js` (hook into login flow + add new functions)

- [ ] **Step 1: Add WebAuthn button visibility check to the login screen initialization**

Find the `showLogin()` function in shared.js (or where the login screen is shown). If `showLogin()` doesn't exist as a standalone function, find where `loginScreen` is made visible. Add after it:

```javascript
// WebAuthn: Biometrie-Button anzeigen wenn verfügbar
async function initWebauthnLogin() {
  const btn = document.getElementById('webauthnLoginBtn');
  if (!btn) return;
  const verfuegbar = await WebAuthnClient.istVerfuegbar();
  btn.style.display = verfuegbar ? '' : 'none';
}
```

Add `initWebauthnLogin()` call at the end of the existing `showLogin()` function (shared.js line 18-21). The function currently just toggles CSS classes. Add the call inside it:

```javascript
function showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appContent').classList.add('hidden');
    initWebauthnLogin();
}
```

- [ ] **Step 2: Add webauthnLogin() function for biometric login from login page**

Add at the end of shared.js:

```javascript
// WebAuthn: Biometrischer Login
async function webauthnLogin() {
  const benutzername = document.getElementById('authUser').value.trim();
  const errorEl = document.getElementById('authError');
  if (!benutzername) {
    errorEl.textContent = 'Bitte Benutzername eingeben.';
    errorEl.style.display = '';
    return;
  }
  errorEl.style.display = 'none';
  try {
    const result = await WebAuthnClient.starteAnmeldung(benutzername);
    currentUser = result.benutzer;
    showApp();
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      errorEl.textContent = 'Anmeldung abgebrochen.';
    } else {
      errorEl.textContent = e.message || 'Biometrische Anmeldung fehlgeschlagen.';
    }
    errorEl.style.display = '';
  }
}
```

- [ ] **Step 3: Add WebAuthn prompt logic after successful password login**

Find the `submitAuth()` function (around line 35-55 in shared.js). After the successful login branch where `showApp()` is called (around line 47), add the WebAuthn prompt check:

Find this pattern:
```javascript
currentUser = await res.json();
// or similar, then showApp() is called
```

Add after `showApp()`:
```javascript
// WebAuthn: Biometrie-Prompt anzeigen
webauthnNachLoginPruefen();
```

Then add the function:

```javascript
async function webauthnNachLoginPruefen() {
  try {
    const verfuegbar = await WebAuthnClient.istVerfuegbar();
    if (!verfuegbar) return;
    // currentUser hat nach Login { benutzername } oder nach /api/auth/me { benutzername, ... }
    const benutzername = currentUser && currentUser.benutzername;
    if (!benutzername) return;
    if (!WebAuthnClient.sollPromptZeigen(benutzername)) return;
    document.getElementById('webauthnPromptOverlay').style.display = '';
    // Gerätename-Vorschlag basierend auf User-Agent
    const ua = navigator.userAgent;
    let vorschlag = 'Mein Gerät';
    if (/iPhone/i.test(ua)) vorschlag = 'iPhone';
    else if (/iPad/i.test(ua)) vorschlag = 'iPad';
    else if (/Android/i.test(ua)) vorschlag = 'Android';
    else if (/Windows/i.test(ua)) vorschlag = 'Windows PC';
    else if (/Mac/i.test(ua)) vorschlag = 'Mac';
    document.getElementById('webauthnGeraetename').value = vorschlag;
  } catch (e) {
    console.error('WebAuthn Prompt Fehler:', e);
  }
}

async function webauthnPromptAnnehmen() {
  const geraetename = document.getElementById('webauthnGeraetename').value.trim();
  const errorEl = document.getElementById('webauthnPromptError');
  if (!geraetename) {
    errorEl.textContent = 'Bitte Gerätename eingeben.';
    errorEl.style.display = '';
    return;
  }
  errorEl.style.display = 'none';
  try {
    await WebAuthnClient.starteRegistrierung(geraetename);
    WebAuthnClient.markiereRegistriert(currentUser.benutzername);
    document.getElementById('webauthnPromptOverlay').style.display = 'none';
    alert('Biometrische Anmeldung erfolgreich eingerichtet!');
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      errorEl.textContent = 'Einrichtung abgebrochen. Du kannst es jederzeit im Profil erneut versuchen.';
    } else {
      errorEl.textContent = e.message || 'Einrichtung fehlgeschlagen.';
    }
    errorEl.style.display = '';
  }
}

function webauthnPromptAblehnen() {
  if (currentUser && currentUser.benutzername) {
    WebAuthnClient.markiereAbgelehnt(currentUser.benutzername);
  }
  document.getElementById('webauthnPromptOverlay').style.display = 'none';
}
```

- [ ] **Step 4: Add profile device management functions**

Add at the end of shared.js:

```javascript
// WebAuthn: Profil - Geräte verwalten
async function webauthnLadeGeraeteProfil() {
  const section = document.getElementById('webauthnGeraeteSection');
  const nichtVerfuegbar = document.getElementById('webauthnNichtVerfuegbar');
  if (!section || !nichtVerfuegbar) return;

  const verfuegbar = await WebAuthnClient.istVerfuegbar();
  if (!verfuegbar) {
    nichtVerfuegbar.style.display = '';
    section.style.display = 'none';
    return;
  }

  nichtVerfuegbar.style.display = 'none';
  section.style.display = '';

  try {
    const geraete = await WebAuthnClient.ladeGeraete();
    const liste = document.getElementById('webauthnGeraeteListe');
    if (geraete.length === 0) {
      liste.innerHTML = '<p style="color:var(--text-muted);">Keine Geräte registriert.</p>';
      return;
    }
    liste.innerHTML = geraete.map(g => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-color);">
        <div>
          <strong>${esc(g.geraetename)}</strong><br>
          <small style="color:var(--text-muted);">${new Date(g.erstelltAm).toLocaleDateString('de-CH')}</small>
        </div>
        <button class="btn btn-danger btn-sm" onclick="webauthnGeraetEntfernen(${g.id}, '${esc(g.geraetename)}')">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `).join('');
  } catch (e) {
    console.error('Fehler beim Laden der Geräte:', e);
  }
}

async function webauthnGeraetEntfernen(id, name) {
  if (!confirm(`Gerät "${name}" wirklich entfernen?`)) return;
  try {
    await WebAuthnClient.loescheGeraet(id);
    webauthnLadeGeraeteProfil();
  } catch (e) {
    alert(e.message || 'Fehler beim Entfernen.');
  }
}

async function webauthnNeuesGeraet() {
  const name = prompt('Gerätename:');
  if (!name || !name.trim()) return;
  try {
    await WebAuthnClient.starteRegistrierung(name.trim());
    WebAuthnClient.markiereRegistriert(currentUser.benutzername);
    webauthnLadeGeraeteProfil();
    alert('Gerät erfolgreich registriert!');
  } catch (e) {
    if (e.name !== 'NotAllowedError') {
      alert(e.message || 'Registrierung fehlgeschlagen.');
    }
  }
}

// Note: Uses existing esc() function from shared.js for HTML escaping
```

- [ ] **Step 5: Hook profile device loading into profile open function**

Find where the profile modal is opened (function that sets `profilOverlay` display). Add a call to `webauthnLadeGeraeteProfil()` there. Look for the function that opens the profile (likely called `openProfil()` or similar) and add at the end:

```javascript
webauthnLadeGeraeteProfil();
```

- [ ] **Step 6: Verify syntax of all modified files**

```bash
node -c public/shared.js
node -c public/webauthn.js
```
Expected: No syntax errors.

- [ ] **Step 7: Commit**

```bash
git add public/shared.js
git commit -m "feat(webauthn): wire up WebAuthn login, prompt, and profile management"
```

---

### Task 12: Update Service Worker Cache

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Update the service worker cache version and add new files**

In `public/sw.js`, find the cache version string (currently `einkaufsliste-v8`). Increment it to `einkaufsliste-v9`.

Find the array of URLs to cache and add:
```javascript
'./lib/simplewebauthn-browser.min.js',
'./webauthn.js',
```

- [ ] **Step 2: Commit**

```bash
git add public/sw.js
git commit -m "feat(webauthn): update service worker cache with WebAuthn files"
```

---

## Chunk 3: Manual Integration Testing

### Task 13: End-to-End Testing

- [ ] **Step 1: Start the server**

```bash
node server.js
```

- [ ] **Step 2: Test biometric login button visibility**

Open `http://localhost:3000` in a mobile browser or Chrome DevTools mobile emulation.
- Expected: Biometric login button should be visible on devices with platform authenticator support.
- On desktop Chrome without Windows Hello: button may be hidden.

- [ ] **Step 3: Test registration flow**

1. Log in with username/password
2. After-login prompt should appear asking to set up biometrics
3. Enter device name, click "Ja, einrichten"
4. Browser should show biometric dialog (or security key prompt)
5. After success: prompt closes, success message shown

- [ ] **Step 4: Test biometric login flow**

1. Log out
2. Enter username in login form
3. Click "Mit Biometrie anmelden"
4. Browser shows biometric dialog
5. After success: redirected to app

- [ ] **Step 5: Test profile device management**

1. Open profile
2. "Biometrische Anmeldung" section should show registered devices
3. Click "Entfernen" on a device → confirmation → device removed
4. Click "Neues Gerät hinzufügen" → registration flow

- [ ] **Step 6: Test error scenarios**

1. Click biometric login without entering username → error message
2. Cancel biometric dialog → "Anmeldung abgebrochen" message
3. Try biometric login with unknown username → generic error (no user enumeration)

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(webauthn): integration test fixes"
```
