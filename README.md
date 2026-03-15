# HaushaltPLUS

Eine Progressive Web App (PWA) für die gemeinsame Einkaufsplanung im Haushalt — mit Wochenplan, Rezepten, Kundenkarten und aktuellen Aktionen von Schweizer Detailhändlern.

## Features

- **Einkaufsliste** — Artikel mit Menge, Einheit, Laden und Fälligkeitsdatum verwalten. Nach Laden filtern, nach Name suchen, als gekauft markieren.
- **Wochenplan** — Mahlzeiten für die Woche planen (Frühstück, Mittag, Abend, Snacks) mit Rezeptintegration und Personenangabe.
- **Rezepte & Gerichte** — Online-Rezeptsuche, Favoriten speichern, eigene Gerichte mit Zutaten erstellen. Zutaten direkt auf die Einkaufsliste übernehmen.
- **Aktionen** — Aktuelle Angebote von Migros, Coop, Denner, Lidl, Aldi und weiteren Schweizer Detailhändlern. Automatische Erkennung passender Aktionen für Artikel auf der Liste. Inkl. Tankrabatte (Coop Pronto).
- **Kundenkarten** — Kundenkarten mit Barcode-Anzeige und -Scanner verwalten. Automatische Logo-Erkennung für Schweizer Läden. Suche, Validierung und Notizen.
- **Haushalt** — Haushalt erstellen, Mitglieder per Code einladen, gemeinsame Listen und Pläne. Rollenbasierter Zugriff (Lesen/Schreiben).
- **Profil** — Benutzerprofil verwalten, Passwort ändern, E-Mail-Adresse aktualisieren, Haushalt-Einstellungen.
- **PWA / Offline** — Als App auf dem Handy oder Desktop installierbar. Offline-Unterstützung via Service Worker.
- **Admin-Panel** — Benutzer-, Haushalte- und Laden-Verwaltung. Benutzer aktivieren/deaktivieren, Rollen zuweisen, Läden und Kundenkarten-Logos verwalten.
- **Bug melden** — Probleme direkt aus der App anonym melden (auf jeder Seite via 3-Punkte-Menü). Die Meldung wird automatisch als GitHub Issue erstellt.

## Tech Stack

| Komponente | Technologie |
|------------|-------------|
| Backend | Node.js, Express |
| Datenbank | Microsoft SQL Server |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Authentifizierung | Session-basiert, WebAuthn/FIDO2 (biometrische Anmeldung) |
| E-Mail | Nodemailer |
| Barcode | JsBarcode (Anzeige), html5-qrcode (Scanner) |
| PWA | Service Worker, Web Manifest |
| Icons | Bootstrap Icons |
| Hosting | Azure / IIS mit iisnode |

## Voraussetzungen

- [Node.js](https://nodejs.org/) (v18+)
- Microsoft SQL Server (lokal oder Azure)
- SMTP-Server für E-Mail-Versand (Registrierung, Passwort-Reset)

## Installation

```bash
git clone https://github.com/surendiransithamparam/HaushaltPLUS.git
cd HaushaltPLUS
npm install
```

## Konfiguration

Der Server erwartet folgende Umgebungsvariablen:

| Variable | Beschreibung |
|----------|-------------|
| `DB_SERVER` | SQL Server Hostname |
| `DB_NAME` | Datenbankname |
| `DB_USER` | Datenbank-Benutzer |
| `DB_PASSWORD` | Datenbank-Passwort |
| `SMTP_HOST` | SMTP-Server |
| `SMTP_PORT` | SMTP-Port |
| `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | Absender-Adresse |
| `BASE_URL` | Öffentliche URL der App |
| `SESSION_SECRET` | Session-Secret |
| `GITHUB_TOKEN` | GitHub Personal Access Token (für Bug-Reports) |
| `GITHUB_OWNER` | GitHub Repository Owner (Standard: `surendiransithamparam`) |
| `GITHUB_REPO` | GitHub Repository Name (Standard: `HaushaltPLUS`) |

## Starten

```bash
npm start
```

Die App ist dann unter `http://localhost:3000` erreichbar.

## Projektstruktur

```
HaushaltPLUS/
├── server.js              # Express Backend (API + DB)
├── package.json           # Abhängigkeiten
├── web.config             # IIS-Konfiguration
├── public/                # Frontend
│   ├── index.html         # Einkaufsliste (Hauptseite)
│   ├── wochenplan.html    # Wochenplan
│   ├── rezepte.html       # Rezepte
│   ├── tankrabatte.html   # Aktionen & Tankrabatte
│   ├── kundenkarten.html  # Kundenkarten
│   ├── profil.html        # Benutzerprofil
│   ├── about.html         # Über die App
│   ├── register.html      # Registrierung
│   ├── reset.html         # Passwort zurücksetzen
│   ├── admin.html         # Admin-Dashboard
│   ├── app.js             # Einkaufsliste-Logik
│   ├── app.css            # Styles
│   ├── shared.js          # Auth & gemeinsame Funktionen
│   ├── bugreport.js       # Bug-Report-Dialog (alle Seiten)
│   ├── kundenkarten.js    # Kundenkarten-Logik
│   ├── wochenplan.js      # Wochenplan-Logik
│   ├── wochenplan.css     # Wochenplan-Styles
│   ├── rezepte.js         # Rezepte-Logik
│   ├── webauthn.js        # WebAuthn/FIDO2-Integration
│   ├── sw.js              # Service Worker
│   ├── manifest.json      # PWA-Manifest
│   └── icons/             # App-Icons
└── .github/workflows/     # CI/CD
```

## API-Endpunkte

| Bereich | Pfad | Beschreibung |
|---------|------|-------------|
| Auth | `POST /api/auth/register` | Registrierung |
| Auth | `POST /api/auth/login` | Anmeldung |
| Auth | `POST /api/auth/change-password` | Passwort ändern |
| Auth | `POST /api/webauthn/*` | WebAuthn/FIDO2 Registrierung & Login |
| Artikel | `GET/POST /api/artikel` | Einkaufsliste lesen/schreiben |
| Artikel | `PUT/DELETE /api/artikel/:id` | Artikel bearbeiten/löschen |
| Wochenplan | `GET/POST /api/wochenplan` | Wochenplan lesen/schreiben |
| Rezepte | `GET/POST /api/gerichte` | Eigene Gerichte |
| Rezepte | `GET /api/rezept/suche` | Rezeptsuche |
| Favoriten | `GET/POST /api/favoriten` | Favoriten verwalten |
| Aktionen | `GET /api/aktionen` | Aktuelle Angebote |
| Kundenkarten | `GET/POST/PUT/DELETE /api/kundenkarten` | Kundenkarten CRUD |
| Kundenkarten | `GET /api/kundenkarten-logos` | Logo-Zuordnungen |
| Haushalt | `POST /api/haushalt` | Haushalt erstellen/beitreten |
| Admin | `GET /api/admin/benutzer` | Benutzerverwaltung |
| Admin | `GET /api/admin/haushalte` | Haushalte-Verwaltung |
| Admin | `POST/PUT/DELETE /api/admin/laden` | Laden-Verwaltung (CRUD) |
| Admin | `GET/PUT /api/admin/kundenkarten-logos` | Kundenkarten-Logo-Verwaltung |
| Bug Report | `POST /api/bugreport` | Anonymen Bug-Report erstellen |
| Health | `GET /api/health` | Health Check |

## Sicherheit

- Passwort-Hashing mit PBKDF2 (100'000 Iterationen, zufälliger Salt)
- E-Mail-Verifizierung bei Registrierung
- Passwortrichtlinie: mindestens 8 Zeichen, Gross-/Kleinbuchstaben, Sonderzeichen
- Session-basierte Authentifizierung
- WebAuthn/FIDO2 für biometrische Anmeldung (Fingerabdruck, Face ID)
- Rollenbasierte Zugriffskontrolle (Admin, Schreiben, Lesen)
- XSS-Schutz durch konsequentes HTML-Escaping

## Lizenz

Dieses Projekt ist privat. Alle Rechte vorbehalten.
