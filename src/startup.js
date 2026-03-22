const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('./config/db');
const config = require('./config/config');
const { hashPassword } = require('./utils/crypto');

const adminPassword = config.adminPassword || '';

async function startup() {
  try {
    const db = await getPool();

    // Ensure all base tables exist
    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Sessions')
      CREATE TABLE Sessions (
          sid NVARCHAR(255) PRIMARY KEY,
          sess NVARCHAR(MAX) NOT NULL,
          expire DATETIME NOT NULL
      )`);
    await db.request().query(`
      IF NOT EXISTS (SELECT name FROM sys.indexes WHERE name='IX_Sessions_expire')
      CREATE INDEX IX_Sessions_expire ON Sessions (expire)`);

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

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='Kundenkarte')
      CREATE TABLE Kundenkarte (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          Name NVARCHAR(200) NOT NULL,
          Kartennummer NVARCHAR(500) NOT NULL,
          Notiz NVARCHAR(500) NULL,
          BenutzerId INT NOT NULL,
          HaushaltId INT NULL,
          ErstelltAm DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
          FOREIGN KEY (BenutzerId) REFERENCES Benutzer(Id)
      )`);

    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name='KundenkartenLogo')
      CREATE TABLE KundenkartenLogo (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          StoreName NVARCHAR(200) NOT NULL UNIQUE,
          LogoUrl NVARCHAR(1000) NULL
      )`);

    // Ensure BarcodeFormat column on Kundenkarte (for existing databases)
    await db.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('Kundenkarte') AND name='BarcodeFormat')
      ALTER TABLE Kundenkarte ADD BarcodeFormat NVARCHAR(20) NULL`);

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
      const logPath = path.join(__dirname, '..', 'startup-error.txt');
      fs.writeFileSync(logPath, `${new Date().toISOString()}\n${err.stack || err}`);
    } catch { /* ignore write errors */ }
  }
}

module.exports = startup;
