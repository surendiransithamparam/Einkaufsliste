const { sql } = require('../config/db');

async function getAll(req, res) {
  try {
    const { userId, hid, db } = req.ctx;

    const where = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request();
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT Id, Name, ErstelltAm FROM Gericht WHERE ${where} ORDER BY Name`);
    res.ok(result.recordset.map(r => ({ id: r.Id, name: r.Name })));
  } catch (err) {
    console.error('gerichte get error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function getById(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { userId, hid, db } = req.ctx;

    const where = hid != null ? 'g.HaushaltId=@hid' : 'g.BenutzerId=@uid AND g.HaushaltId IS NULL';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT g.Id, g.Name FROM Gericht g WHERE g.Id=@id AND ${where}`);
    if (result.recordset.length === 0) return res.fail(404, 'Nicht gefunden');

    const gericht = result.recordset[0];
    const zResult = await db.request()
      .input('gid', sql.Int, id)
      .query('SELECT Id, Artikel, Menge, Einheit FROM GerichtZutat WHERE GerichtId=@gid ORDER BY Id');

    res.ok({
      id: gericht.Id,
      name: gericht.Name,
      zutaten: zResult.recordset.map(z => ({
        id: z.Id, artikel: z.Artikel, menge: z.Menge, einheit: z.Einheit
      }))
    });
  } catch (err) {
    console.error('gerichte get by id error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function create(req, res) {
  try {
    const { userId, hid, canWrite, db } = req.ctx;
    const name = (req.body.name || '').trim();
    if (name.length < 1) return res.fail(400, 'Name ist erforderlich.');
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const result = await db.request()
      .input('name', sql.NVarChar, name)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query('INSERT INTO Gericht (Name, BenutzerId, HaushaltId) OUTPUT INSERTED.Id VALUES (@name, @uid, @hid)');
    const gerichtId = result.recordset[0].Id;

    if (req.body.zutaten && Array.isArray(req.body.zutaten)) {
      for (const z of req.body.zutaten) {
        const artikel = (z.artikel || '').trim();
        if (!artikel) continue;
        await db.request()
          .input('gid', sql.Int, gerichtId)
          .input('artikel', sql.NVarChar, artikel)
          .input('menge', sql.Decimal(18, 2), z.menge != null ? z.menge : 1)
          .input('einheit', sql.NVarChar, z.einheit || 'Stück')
          .query('INSERT INTO GerichtZutat (GerichtId, Artikel, Menge, Einheit) VALUES (@gid, @artikel, @menge, @einheit)');
      }
    }

    res.ok({ id: gerichtId });
  } catch (err) {
    console.error('gerichte post error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';

    if (req.body.name !== undefined) {
      const request = db.request()
        .input('id', sql.Int, id)
        .input('name', sql.NVarChar, (req.body.name || '').trim());
      if (hid != null) request.input('hid', sql.Int, hid);
      else request.input('uid', sql.Int, userId);
      const result = await request.query(`UPDATE Gericht SET Name=@name WHERE ${where}`);
      if (result.rowsAffected[0] === 0) return res.fail(404, 'Nicht gefunden');
    }

    if (req.body.zutaten !== undefined && Array.isArray(req.body.zutaten)) {
      await db.request()
        .input('gid', sql.Int, id)
        .query('DELETE FROM GerichtZutat WHERE GerichtId=@gid');

      for (const z of req.body.zutaten) {
        const artikel = (z.artikel || '').trim();
        if (!artikel) continue;
        await db.request()
          .input('gid', sql.Int, id)
          .input('artikel', sql.NVarChar, artikel)
          .input('menge', sql.Decimal(18, 2), z.menge != null ? z.menge : 1)
          .input('einheit', sql.NVarChar, z.einheit || 'Stück')
          .query('INSERT INTO GerichtZutat (GerichtId, Artikel, Menge, Einheit) VALUES (@gid, @artikel, @menge, @einheit)');
      }
    }

    res.ok();
  } catch (err) {
    console.error('gerichte put error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`DELETE FROM Gericht WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.ok();
    else res.fail(404, 'Nicht gefunden');
  } catch (err) {
    console.error('gerichte delete error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

module.exports = { getAll, getById, create, update, remove };
