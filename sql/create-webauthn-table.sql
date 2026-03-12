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
