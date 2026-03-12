# WebAuthn/FIDO2 Biometric Login - Design Spec

## Zusammenfassung

Implementierung von biometrischer Authentifizierung (Fingerabdruck / Face ID) für die Einkaufsliste-PWA mittels WebAuthn/FIDO2. User können nach einem erfolgreichen Passwort-Login optional Biometrie einrichten und sich danach per Fingerabdruck oder Gesichtserkennung anmelden.

## Anforderungen

- WebAuthn als **ergänzende** Login-Methode neben Passwort
- **Mehrere Geräte** pro Account registrierbar
- Einrichtung wird **nach erfolgreichem Login** angeboten
- Registrierte Geräte im **Profil verwaltbar** (anzeigen, entfernen)
- Passwort-Login bleibt **immer als Fallback** verfügbar (auch wenn User bevorzugt Biometrie nutzt)

## Technologie

- **Backend**: `@simplewebauthn/server` (Node.js)
- **Frontend**: `@simplewebauthn/browser` - eingebunden als vendored UMD-Bundle unter `/public/lib/simplewebauthn-browser.min.js` (kein Bundler nötig, passt zum bestehenden Vanilla-JS-Setup)
- **Standard**: WebAuthn Level 2 / FIDO2
- **Kein externer Auth-Service** - alles self-hosted

## Konfiguration

Neue Felder in `config.json` bzw. als Environment-Variablen:

| Key | Beispiel | Beschreibung |
|-----|----------|-------------|
| `WEBAUTHN_RP_ID` | `"einkaufsliste.example.com"` | Relying Party ID, muss zur Domain passen |
| `WEBAUTHN_RP_NAME` | `"Einkaufsliste"` | Anzeigename der Relying Party |
| `WEBAUTHN_ORIGIN` | `"https://einkaufsliste.example.com"` | Erwartete Origin für Verifikation |

Fallback für Entwicklung: `rpId = "localhost"`, `origin = "http://localhost:<port>"`.

## Datenbank

### Neue Tabelle: `WebAuthnCredential`

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| `Id` | `INT IDENTITY PRIMARY KEY` | Primärschlüssel |
| `BenutzerId` | `INT NOT NULL` | FK → `Benutzer.Id` |
| `CredentialId` | `NVARCHAR(2048) NOT NULL` | Base64URL-encoded Credential ID (bis 1364 Zeichen möglich) |
| `CredentialIdHash` | `AS HASHBYTES('SHA2_256', CredentialId) PERSISTED` | Computed Hash-Spalte für UNIQUE-Index (SQL Server erlaubt max 900 Bytes in Index-Keys) |
| `PublicKey` | `VARBINARY(MAX) NOT NULL` | COSE-encoded Public Key |
| `Counter` | `INT NOT NULL DEFAULT 0` | Signatur-Counter für Replay-Schutz |
| `Geraetename` | `NVARCHAR(100) NOT NULL` | Vom User vergebener Gerätename |
| `Transports` | `NVARCHAR(500) NULL` | JSON-Array der Transports, z.B. `["internal","hybrid"]` |
| `ErstelltAm` | `DATETIME2 NOT NULL DEFAULT GETDATE()` | Erstellungszeitpunkt |

**Index**: `IX_WebAuthnCredential_BenutzerId` auf `BenutzerId`

### SQL Migration

```sql
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

### Rollback

```sql
DROP TABLE IF EXISTS WebAuthnCredential;
```

## Backend API-Endpoints

Alle Endpoints unter `/api/webauthn/`. Challenge-Daten werden in der Express-Session gespeichert mit einer **TTL von 60 Sekunden** (Server prüft Zeitstempel bei Verifikation).

Rate-Limiting: Gleiche Konfiguration wie Passwort-Login — 10 Versuche pro 60 Sekunden pro IP, Prefix `webauthn_login_` bzw. `webauthn_register_`.

### POST /api/webauthn/register-options
- **Auth**: Erfordert aktive Session (`requireAuth`)
- **Request**: `{ geraetename: string }`
- **Aktion**: Generiert Registrierungs-Challenge via `generateRegistrationOptions()`, schliesst bereits registrierte Credentials als `excludeCredentials` ein
- **Response**: WebAuthn `PublicKeyCredentialCreationOptions` (JSON)
- **Session**: Speichert `{ currentChallenge, challengeExpiry: Date.now() + 60000, geraetename }`

### POST /api/webauthn/register-verify
- **Auth**: Erfordert aktive Session (`requireAuth`)
- **Request**: WebAuthn `RegistrationResponseJSON`
- **Aktion**:
  1. Prüft Challenge-TTL (60s), gibt 400 zurück wenn abgelaufen
  2. Verifiziert Response via `verifyRegistrationResponse()` mit `expectedOrigin` und `expectedRPID` aus Config
  3. Speichert Credential in DB mit `geraetename` aus Session
  4. Löscht Challenge aus Session
- **Response**: `{ verifiziert: true, credentialId: string }`
- **Fehler**: 400 bei ungültiger/abgelaufener Response

### POST /api/webauthn/login-options
- **Auth**: Keine (User ist noch nicht eingeloggt)
- **Request**: `{ benutzername: string }`
- **Aktion**:
  1. Sucht User in DB
  2. Falls User existiert: Lädt alle Credentials, generiert Challenge mit `allowCredentials`
  3. Falls User nicht existiert: Generiert Challenge mit zufälligen Fake-Credential-IDs (gleiche Anzahl/Länge wie typische Responses, verhindert User-Enumeration)
- **Response**: WebAuthn `PublicKeyCredentialRequestOptions` (JSON)
- **Session**: Speichert `{ currentChallenge, challengeExpiry: Date.now() + 60000, webauthnUserId }` (userId nur bei existierendem User)

### POST /api/webauthn/login-verify
- **Auth**: Keine
- **Request**: WebAuthn `AuthenticationResponseJSON`
- **Aktion**:
  1. Prüft Challenge-TTL (60s)
  2. Sucht Credential in DB anhand `credentialId` aus Response
  3. Verifiziert Signatur via `verifyAuthenticationResponse()`
  4. Prüft `EmailBestaetigt` — gibt 403 zurück wenn nicht aktiviert (gleich wie Passwort-Login)
  5. Aktualisiert Counter in DB
  6. Erstellt Session: `req.session.userId = user.Id`, `req.session.userName = user.Benutzername` (identisch zum Passwort-Login in server.js:607-608)
  7. Löscht Challenge aus Session
- **Response**: `{ verifiziert: true, benutzer: { id, benutzername } }`
- **Fehler**: 400 bei ungültiger Signatur, 403 bei nicht aktiviertem Account

### GET /api/webauthn/credentials
- **Auth**: Erfordert aktive Session
- **Response**: `[{ id, geraetename, erstelltAm }]` - Liste aller Credentials des Users

### DELETE /api/webauthn/credentials/:id
- **Auth**: Erfordert aktive Session
- **Aktion**: Löscht Credential, nur wenn es dem eingeloggten User gehört
- **Response**: `{ erfolg: true }`
- **Fehler**: 404 wenn nicht gefunden oder nicht dem User gehörend

## Frontend-Änderungen

### Login-Seite (index.html)

- **Feature-Detection**: `if (window.PublicKeyCredential)` prüft ob WebAuthn unterstützt wird
- **Biometrie-Button**: Neuer Button "Mit Fingerabdruck / Face ID anmelden" unterhalb des Passwort-Formulars
- **Flow**: User gibt Benutzername ein → klickt Biometrie-Button → Browser zeigt Biometrie-Dialog → Login erfolgt
- **Fallback**: Button wird nicht angezeigt, wenn Browser WebAuthn nicht unterstützt
- **Fehlerbehandlung**:
  - User bricht Biometrie-Dialog ab → Fehlermeldung "Anmeldung abgebrochen", User kann es erneut versuchen oder Passwort nutzen
  - Timeout/Fehler → Fehlermeldung mit Hinweis auf Passwort-Login als Alternative

### Nach-Login-Prompt

- Nach erfolgreichem Passwort-Login prüft das Frontend via `localStorage` Key `webauthn_registered_<userId>`:
  - Falls Key existiert: Kein Prompt (dieses Gerät hat bereits Biometrie eingerichtet)
  - Falls Key nicht existiert UND `localStorage` Key `webauthn_dismissed_<userId>` nicht gesetzt oder älter als 30 Tage: Zeige Prompt
- Modal/Banner zeigt "Möchtest du beim nächsten Mal Fingerabdruck / Face ID nutzen?"
- **"Ja"**: Fragt nach Gerätenamen (Vorschlag: User-Agent-basiert, z.B. "iPhone" / "Android"), startet Registrierungsflow
- **"Nein"** / **"Später"**: Modal schliessen, `webauthn_dismissed_<userId>` mit Timestamp in `localStorage` setzen (30 Tage Cooldown)
- Bei erfolgreicher Registrierung: `webauthn_registered_<userId>` in `localStorage` setzen
- **Fehlerbehandlung**: User bricht Biometrie-Dialog ab → "Einrichtung abgebrochen. Du kannst es jederzeit im Profil erneut versuchen."

### Profil-Bereich

- Neue Sektion "Biometrische Anmeldung" im Profil
- Tabelle/Liste der registrierten Geräte: Gerätename, Datum
- "Entfernen"-Button pro Gerät mit Bestätigungs-Dialog
- "Neues Gerät hinzufügen"-Button (startet gleichen Registrierungsflow)

### Neue Datei: public/webauthn.js

Client-seitige WebAuthn-Logik:
- `starteRegistrierung(geraetename)` - Registrierungsflow (register-options → Browser-API → register-verify)
- `starteAnmeldung(benutzername)` - Login-Flow (login-options → Browser-API → login-verify)
- `ladeGeraete()` - Geräteliste laden
- `loescheGeraet(id)` - Gerät entfernen
- Nutzt `@simplewebauthn/browser` Funktionen (`startRegistration`, `startAuthentication`)

## User Flows

### Flow 1: Biometrie einrichten (nach Login)

```
User loggt sich mit Passwort ein
  → System prüft localStorage: webauthn_registered_<userId> vorhanden?
  → Nein + WebAuthn unterstützt + nicht kürzlich abgelehnt
  → Zeigt Prompt "Biometrie einrichten?"
  → User tippt "Ja", gibt Gerätenamen ein
  → POST /api/webauthn/register-options
  → Browser zeigt Biometrie-Dialog (Fingerabdruck / Face ID)
  → POST /api/webauthn/register-verify
  → localStorage Flag setzen
  → Erfolgsmeldung: "Gerät registriert!"
```

### Flow 2: Biometrischer Login

```
User öffnet Login-Seite
  → WebAuthn unterstützt? Zeigt Biometrie-Button
  → User gibt Benutzername ein, klickt Biometrie-Button
  → POST /api/webauthn/login-options
  → Browser zeigt Biometrie-Dialog
  → POST /api/webauthn/login-verify
  → Session erstellt (userId + userName), Weiterleitung zur App
```

### Flow 3: Gerät verwalten

```
User geht ins Profil → Sektion "Biometrische Anmeldung"
  → GET /api/webauthn/credentials
  → Liste der Geräte wird angezeigt
  → User klickt "Entfernen" bei einem Gerät
  → Bestätigungs-Dialog: "Gerät XY wirklich entfernen?"
  → DELETE /api/webauthn/credentials/:id
  → Gerät aus Liste entfernt
```

### Flow 4: Fehlerszenarien

```
User bricht Biometrie-Dialog ab
  → Meldung: "Anmeldung abgebrochen"
  → Login-Formular bleibt sichtbar, User kann Passwort nutzen

User hat kein registriertes Gerät, klickt Biometrie-Button
  → Biometrie-Dialog schlägt fehl (keine passenden Credentials)
  → Meldung: "Kein biometrisches Gerät registriert. Bitte zuerst mit Passwort anmelden."

Challenge abgelaufen (>60s)
  → Server gibt 400 zurück
  → Meldung: "Zeitüberschreitung. Bitte erneut versuchen."
```

## Sicherheit

- **Challenge-TTL**: 60 Sekunden, Server-seitig geprüft, danach ungültig
- **Challenge-Einmalverwendung**: Challenge wird nach erfolgreicher Verifikation aus der Session gelöscht
- **Counter-Validierung**: Signatur-Counter wird bei jedem Login geprüft und inkrementiert (Replay-Schutz)
- **User-Enumeration-Schutz**: Login-Options gibt bei unbekanntem Username eine Challenge mit zufälligen Fake-Credential-IDs zurück (gleiche Response-Struktur)
- **Origin-Validierung**: Server prüft `expectedOrigin` und `expectedRPID` aus Konfiguration
- **Account-Status-Prüfung**: Login-Verify prüft `EmailBestaetigt` identisch zum Passwort-Login
- **Session-Parität**: WebAuthn-Login setzt exakt die gleichen Session-Felder wie Passwort-Login (`userId`, `userName`)
- **Rate-Limiting**: 10 Versuche pro 60s pro IP (gleich wie Passwort-Login)
- **HTTPS-Pflicht**: WebAuthn funktioniert nur über HTTPS (oder localhost für Entwicklung)
- **Kein Credential-Export**: Private Keys verlassen nie das Gerät des Users

## Einschränkungen

- WebAuthn erfordert **HTTPS** in Production (localhost ist Ausnahme für Dev)
- Ältere Browser ohne WebAuthn-Support sehen den Biometrie-Button nicht (graceful degradation)
- `@simplewebauthn/browser` wird als **vendored UMD-Bundle** unter `public/lib/` eingebunden (kein Bundler nötig)
- Session-Cookie nutzt `sameSite: 'strict'` — bei Problemen mit Roaming-Authenticatoren (z.B. FIDO2-Security-Keys über Bluetooth) muss auf `'lax'` gewechselt werden. Für den primären Use-Case (Platform-Authenticator = Fingerabdruck/Face ID auf dem gleichen Gerät) ist `strict` kein Problem.
