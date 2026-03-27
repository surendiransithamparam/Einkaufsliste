const { getPool, sql } = require('../config/db');
const { getHaushaltId, canWrite } = require('../utils/dbHelpers');

async function getAll(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);
    let result;
    if (hid != null) {
      result = await db.request().input('hid', sql.Int, hid)
        .query('SELECT Id, Name, Kartennummer, Notiz, BarcodeFormat, ErstelltAm FROM Kundenkarte WHERE HaushaltId=@hid ORDER BY Name');
    } else {
      result = await db.request().input('uid', sql.Int, userId)
        .query('SELECT Id, Name, Kartennummer, Notiz, BarcodeFormat, ErstelltAm FROM Kundenkarte WHERE BenutzerId=@uid AND HaushaltId IS NULL ORDER BY Name');
    }
    res.json(result.recordset.map(r => ({ id: r.Id, name: r.Name, kartennummer: r.Kartennummer, notiz: r.Notiz || '', barcodeFormat: r.BarcodeFormat || null, erstelltAm: r.ErstelltAm })));
  } catch (e) {
    console.error('Kundenkarten GET Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function create(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({ error: 'Keine Schreibrechte.' });
    const hid = await getHaushaltId(userId, db);
    const { name, kartennummer, notiz, barcodeFormat } = req.body;
    if (!name || !kartennummer) return res.status(400).json({ error: 'Name und Kartennummer erforderlich.' });
    const result = await db.request()
      .input('name', sql.NVarChar, name.trim())
      .input('kartennummer', sql.NVarChar, kartennummer.trim())
      .input('notiz', sql.NVarChar, (notiz || '').trim() || null)
      .input('barcodeFormat', sql.NVarChar, (barcodeFormat || '').trim() || null)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query('INSERT INTO Kundenkarte (Name, Kartennummer, Notiz, BarcodeFormat, BenutzerId, HaushaltId) OUTPUT INSERTED.Id, INSERTED.ErstelltAm VALUES (@name, @kartennummer, @notiz, @barcodeFormat, @uid, @hid)');
    const row = result.recordset[0];
    res.json({ id: row.Id, erstelltAm: row.ErstelltAm });
  } catch (e) {
    console.error('Kundenkarten POST Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({ error: 'Keine Schreibrechte.' });
    const hid = await getHaushaltId(userId, db);
    const { name, kartennummer, notiz, barcodeFormat } = req.body;
    if (!name || !kartennummer) return res.status(400).json({ error: 'Name und Kartennummer erforderlich.' });
    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid AND HaushaltId IS NULL';
    const result = await db.request()
      .input('id', sql.Int, id)
      .input('name', sql.NVarChar, name.trim())
      .input('kartennummer', sql.NVarChar, kartennummer.trim())
      .input('notiz', sql.NVarChar, (notiz || '').trim() || null)
      .input('barcodeFormat', sql.NVarChar, (barcodeFormat || '').trim() || null)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query(`UPDATE Kundenkarte SET Name=@name, Kartennummer=@kartennummer, Notiz=@notiz, BarcodeFormat=@barcodeFormat WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({ error: 'Karte nicht gefunden.' });
  } catch (e) {
    console.error('Kundenkarten PUT Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({ error: 'Keine Schreibrechte.' });
    const hid = await getHaushaltId(userId, db);
    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid AND HaushaltId IS NULL';
    const result = await db.request()
      .input('id', sql.Int, id)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query(`DELETE FROM Kundenkarte WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({ error: 'Karte nicht gefunden.' });
  } catch (e) {
    console.error('Kundenkarten DELETE Fehler:', e);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function getLogos(req, res) {
  try {
    const db = await getPool();
    const result = await db.request()
      .query('SELECT StoreName, LogoUrl FROM KundenkartenLogo WHERE LogoUrl IS NOT NULL');
    const map = {};
    for (const r of result.recordset) {
      map[r.StoreName.toLowerCase()] = r.LogoUrl;
    }
    res.json(map);
  } catch (err) {
    console.error('kundenkarten-logos get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

module.exports = { getAll, create, update, remove, getLogos };
