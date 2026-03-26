const crypto = require('crypto');
const { getPool, sql } = require('../config/db');
const { isRateLimited } = require('../middleware/rateLimit');
const { getWebauthnConfig } = require('../utils/webauthnUtils');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

async function registerOptions(req, res) {
  try {
    if (isRateLimited(req, 'webauthn_register', 10, 60)) return res.fail(429, 'Zu viele Versuche.');
    const { geraetename } = req.body;
    if (!geraetename || geraetename.trim().length < 1) return res.fail(400, 'Gerätename erforderlich.');

    const db = await getPool();
    const userResult = await db.request()
      .input('userId', sql.Int, req.session.userId)
      .query('SELECT Id, Benutzername FROM Benutzer WHERE Id=@userId');
    const user = userResult.recordset[0];
    if (!user) return res.fail(401, 'Nicht authentifiziert.');

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

    res.ok(options);
  } catch (e) {
    console.error('WebAuthn register-options Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

async function registerVerify(req, res) {
  try {
    const challengeData = req.session.webauthnChallenge;
    if (!challengeData) return res.fail(400, 'Keine Challenge vorhanden.');
    if (Date.now() > challengeData.expires) {
      delete req.session.webauthnChallenge;
      return res.fail(400, 'Challenge abgelaufen. Bitte erneut versuchen.');
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
      return res.fail(400, 'Verifizierung fehlgeschlagen.');
    }

    const { credential } = verification.registrationInfo;

    if (!credential || !credential.publicKey) {
      console.error('WebAuthn register-verify: credential oder publicKey fehlt', verification.registrationInfo);
      delete req.session.webauthnChallenge;
      return res.fail(400, 'Registrierung fehlgeschlagen: Credential-Daten unvollständig.');
    }

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
    res.ok({ verifiziert: true, credentialId: credential.id });
  } catch (e) {
    console.error('WebAuthn register-verify Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

async function loginOptions(req, res) {
  try {
    if (isRateLimited(req, 'webauthn_login', 10, 60)) return res.fail(429, 'Zu viele Versuche.');
    const { benutzername } = req.body;
    if (!benutzername) return res.fail(400, 'Benutzername erforderlich.');

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

    res.ok(options);
  } catch (e) {
    console.error('WebAuthn login-options Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

async function loginVerify(req, res) {
  try {
    const challengeData = req.session.webauthnChallenge;
    if (!challengeData) return res.fail(400, 'Keine Challenge vorhanden.');
    if (Date.now() > challengeData.expires) {
      delete req.session.webauthnChallenge;
      return res.fail(400, 'Challenge abgelaufen. Bitte erneut versuchen.');
    }
    if (!challengeData.webauthnUserId) {
      delete req.session.webauthnChallenge;
      return res.fail(400, 'Anmeldung fehlgeschlagen.');
    }

    const db = await getPool();
    const credResult = await db.request()
      .input('credId', sql.NVarChar, req.body.id)
      .input('userId', sql.Int, challengeData.webauthnUserId)
      .query('SELECT Id, CredentialId, PublicKey, Counter, Transports FROM WebAuthnCredential WHERE CredentialId=@credId AND BenutzerId=@userId');

    if (credResult.recordset.length === 0) {
      delete req.session.webauthnChallenge;
      return res.fail(400, 'Anmeldung fehlgeschlagen.');
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
      return res.fail(400, 'Anmeldung fehlgeschlagen.');
    }

    const userResult = await db.request()
      .input('userId', sql.Int, challengeData.webauthnUserId)
      .query('SELECT Id, Benutzername, EmailBestaetigt FROM Benutzer WHERE Id=@userId');

    const user = userResult.recordset[0];
    if (!user) {
      delete req.session.webauthnChallenge;
      return res.fail(400, 'Anmeldung fehlgeschlagen.');
    }
    if (!user.EmailBestaetigt) {
      delete req.session.webauthnChallenge;
      return res.fail(403, 'Konto nicht aktiviert.');
    }

    await db.request()
      .input('id', sql.Int, cred.Id)
      .input('counter', sql.Int, verification.authenticationInfo.newCounter)
      .query('UPDATE WebAuthnCredential SET Counter=@counter WHERE Id=@id');

    req.session.userId = user.Id;
    req.session.userName = user.Benutzername;

    delete req.session.webauthnChallenge;
    res.ok({ verifiziert: true, benutzer: { id: user.Id, benutzername: user.Benutzername } });
  } catch (e) {
    console.error('WebAuthn login-verify Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

async function listCredentials(req, res) {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('userId', sql.Int, req.session.userId)
      .query('SELECT Id, Geraetename, ErstelltAm FROM WebAuthnCredential WHERE BenutzerId=@userId ORDER BY ErstelltAm DESC');
    res.ok(result.recordset.map(r => ({
      id: r.Id,
      geraetename: r.Geraetename,
      erstelltAm: r.ErstelltAm
    })));
  } catch (e) {
    console.error('WebAuthn credentials list Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

async function deleteCredential(req, res) {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('id', sql.Int, parseInt(req.params.id))
      .input('userId', sql.Int, req.session.userId)
      .query('DELETE FROM WebAuthnCredential WHERE Id=@id AND BenutzerId=@userId');
    if (result.rowsAffected[0] === 0) return res.fail(404, 'Gerät nicht gefunden.');
    res.ok({ erfolg: true });
  } catch (e) {
    console.error('WebAuthn credential delete Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

module.exports = {
  registerOptions,
  registerVerify,
  loginOptions,
  loginVerify,
  listCredentials,
  deleteCredential
};
