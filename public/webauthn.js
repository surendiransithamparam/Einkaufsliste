// WebAuthn / FIDO2 Client-Logik
// Nutzt @simplewebauthn/browser (geladen als UMD-Bundle via script tag)
// Global: SimpleWebAuthnBrowser

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
