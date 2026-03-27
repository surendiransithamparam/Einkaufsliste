const { getPool, sql } = require('../config/db');
const { isAdmin, deleteHaushaltCascade } = require('../utils/dbHelpers');
const { hashPassword } = require('../utils/crypto');
const { validatePassword } = require('../utils/validation');

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

// --- Benutzer ---

async function getBenutzer(req, res) {
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
}

async function updateBenutzer(req, res) {
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
    if (req.body.passwort && !validatePassword(req.body.passwort)) {
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
}

async function deleteBenutzer(req, res) {
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
}

// --- Haushalte ---

async function getHaushalte(req, res) {
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
}

async function getHaushaltMitglieder(req, res) {
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
}

async function updateHaushalt(req, res) {
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
}

async function updateHaushaltMitglied(req, res) {
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
}

async function removeHaushaltMitglied(req, res) {
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
}

async function deleteHaushalt(req, res) {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});

    await db.request()
      .input('hid', sql.Int, id)
      .query("UPDATE Benutzer SET HaushaltId=NULL, HaushaltRolle='schreibend' WHERE HaushaltId=@hid");

    await deleteHaushaltCascade(id, db);
    res.json({});
  } catch (err) {
    console.error('admin haushalte delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

// --- Laden ---

async function createLaden(req, res) {
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
}

async function updateLaden(req, res) {
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
}

async function deleteLaden(req, res) {
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
}

// --- Kundenkarten-Logos ---

async function getKundenkartenLogos(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});
    const result = await db.request()
      .query(`SELECT storeName, logoUrl FROM (
                SELECT DISTINCT k.Name AS storeName, l.LogoUrl AS logoUrl
                FROM Kundenkarte k
                LEFT JOIN KundenkartenLogo l ON LOWER(k.Name) = LOWER(l.StoreName)
                UNION
                SELECT l2.StoreName AS storeName, l2.LogoUrl AS logoUrl
                FROM KundenkartenLogo l2
                WHERE NOT EXISTS (SELECT 1 FROM Kundenkarte k2 WHERE LOWER(k2.Name) = LOWER(l2.StoreName))
              ) AS combined ORDER BY storeName`);
    res.json(result.recordset.map(r => ({ storeName: r.storeName, logoUrl: r.logoUrl || null })));
  } catch (err) {
    console.error('admin kundenkarten-logos get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function updateKundenkartenLogo(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await isAdmin(userId, db)) return res.status(403).json({});
    const storeName = (req.body.storeName || '').trim();
    const logoUrl = (req.body.logoUrl || '').trim() || null;
    if (!storeName) return res.status(400).json({ error: 'StoreName erforderlich.' });
    const existing = await db.request()
      .input('name', sql.NVarChar, storeName)
      .query('SELECT Id FROM KundenkartenLogo WHERE LOWER(StoreName)=LOWER(@name)');
    if (existing.recordset.length > 0) {
      await db.request()
        .input('name', sql.NVarChar, storeName)
        .input('url', sql.NVarChar, logoUrl)
        .query('UPDATE KundenkartenLogo SET LogoUrl=@url WHERE LOWER(StoreName)=LOWER(@name)');
    } else {
      await db.request()
        .input('name', sql.NVarChar, storeName)
        .input('url', sql.NVarChar, logoUrl)
        .query('INSERT INTO KundenkartenLogo (StoreName, LogoUrl) VALUES (@name, @url)');
    }
    res.json({});
  } catch (err) {
    console.error('admin kundenkarten-logos put error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

module.exports = {
  getBenutzer,
  updateBenutzer,
  deleteBenutzer,
  getHaushalte,
  getHaushaltMitglieder,
  updateHaushalt,
  updateHaushaltMitglied,
  removeHaushaltMitglied,
  deleteHaushalt,
  createLaden,
  updateLaden,
  deleteLaden,
  getKundenkartenLogos,
  updateKundenkartenLogo
};
