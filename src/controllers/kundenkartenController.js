const { getPool, sql } = require('../config/db');

async function getAll(req, res) {
  try {
    const { userId, hid, db } = req.ctx;
    let result;
    if (hid != null) {
      result = await db.request().input('hid', sql.Int, hid)
        .query('SELECT Id, Name, Kartennummer, Notiz, BarcodeFormat, ErstelltAm FROM Kundenkarte WHERE HaushaltId=@hid ORDER BY Name');
    } else {
      result = await db.request().input('uid', sql.Int, userId)
        .query('SELECT Id, Name, Kartennummer, Notiz, BarcodeFormat, ErstelltAm FROM Kundenkarte WHERE BenutzerId=@uid AND HaushaltId IS NULL ORDER BY Name');
    }
    res.ok(result.recordset.map(r => ({ id: r.Id, name: r.Name, kartennummer: r.Kartennummer, notiz: r.Notiz || '', barcodeFormat: r.BarcodeFormat || null, erstelltAm: r.ErstelltAm })));
  } catch (e) {
    console.error('Kundenkarten GET Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

async function create(req, res) {
  try {
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');
    const { name, kartennummer, notiz, barcodeFormat } = req.body;
    if (!name || !kartennummer) return res.fail(400, 'Name und Kartennummer erforderlich.');
    const result = await db.request()
      .input('name', sql.NVarChar, name.trim())
      .input('kartennummer', sql.NVarChar, kartennummer.trim())
      .input('notiz', sql.NVarChar, (notiz || '').trim() || null)
      .input('barcodeFormat', sql.NVarChar, (barcodeFormat || '').trim() || null)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query('INSERT INTO Kundenkarte (Name, Kartennummer, Notiz, BarcodeFormat, BenutzerId, HaushaltId) OUTPUT INSERTED.Id, INSERTED.ErstelltAm VALUES (@name, @kartennummer, @notiz, @barcodeFormat, @uid, @hid)');
    const row = result.recordset[0];
    res.ok({ id: row.Id, erstelltAm: row.ErstelltAm });
  } catch (e) {
    console.error('Kundenkarten POST Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');
    const { name, kartennummer, notiz, barcodeFormat } = req.body;
    if (!name || !kartennummer) return res.fail(400, 'Name und Kartennummer erforderlich.');
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
    if (result.rowsAffected[0] > 0) res.ok();
    else res.fail(404, 'Karte nicht gefunden.');
  } catch (e) {
    console.error('Kundenkarten PUT Fehler:', e);
    res.fail(500, 'Interner Fehler.');
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');
    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid AND HaushaltId IS NULL';
    const result = await db.request()
      .input('id', sql.Int, id)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query(`DELETE FROM Kundenkarte WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.ok();
    else res.fail(404, 'Karte nicht gefunden.');
  } catch (e) {
    console.error('Kundenkarten DELETE Fehler:', e);
    res.fail(500, 'Interner Fehler.');
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
    res.ok(map);
  } catch (err) {
    console.error('kundenkarten-logos get error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

module.exports = { getAll, create, update, remove, getLogos };
