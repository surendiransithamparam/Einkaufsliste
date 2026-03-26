const { sql } = require('../config/db');

async function getAll(req, res) {
  try {
    const { userId, hid, db } = req.ctx;

    let result;
    if (hid != null) {
      result = await db.request()
        .input('hid', sql.Int, hid)
        .query('SELECT a.Id, a.Artikel, a.Menge, a.Einheit, a.Laden, a.Datum, a.Gekauft, a.ErstelltAm, b.Benutzername FROM Artikel a JOIN Benutzer b ON a.BenutzerId=b.Id WHERE a.HaushaltId=@hid ORDER BY a.Id');
    } else {
      result = await db.request()
        .input('uid', sql.Int, userId)
        .query('SELECT a.Id, a.Artikel, a.Menge, a.Einheit, a.Laden, a.Datum, a.Gekauft, a.ErstelltAm, NULL AS Benutzername FROM Artikel a WHERE a.BenutzerId=@uid AND a.HaushaltId IS NULL ORDER BY a.Id');
    }

    const items = result.recordset.map(r => ({
      id: r.Id,
      artikel: r.Artikel,
      menge: r.Menge,
      einheit: r.Einheit,
      laden: r.Laden || '',
      datum: r.Datum ? r.Datum.toISOString().substring(0, 10) : '',
      gekauft: r.Gekauft,
      erstelltAm: r.ErstelltAm ? r.ErstelltAm.toISOString() : '',
      von: r.Benutzername || null
    }));
    res.ok(items);
  } catch (err) {
    console.error('artikel get error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function create(req, res) {
  try {
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const { artikel, menge, einheit, laden, datum } = req.body;
    const result = await db.request()
      .input('artikel', sql.NVarChar, artikel)
      .input('menge', sql.Decimal(18, 2), menge)
      .input('einheit', sql.NVarChar, einheit)
      .input('laden', sql.NVarChar, laden || null)
      .input('datum', sql.DateTime2, datum ? new Date(datum) : null)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query('INSERT INTO Artikel (Artikel, Menge, Einheit, Laden, Datum, BenutzerId, HaushaltId) OUTPUT INSERTED.Id, INSERTED.ErstelltAm VALUES (@artikel, @menge, @einheit, @laden, @datum, @uid, @hid)');

    const row = result.recordset[0];
    res.ok({ id: row.Id, erstelltAm: row.ErstelltAm.toISOString() });
  } catch (err) {
    console.error('artikel post error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function bulkCreate(req, res) {
  try {
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const { artikel } = req.body;
    if (!Array.isArray(artikel) || artikel.length === 0) return res.fail(400, 'artikel array required');

    const results = [];
    const transaction = new sql.Transaction(db);
    await transaction.begin();
    try {
      for (const item of artikel) {
        const result = await new sql.Request(transaction)
          .input('artikel', sql.NVarChar, item.artikel)
          .input('menge', sql.Decimal(18, 2), item.menge)
          .input('einheit', sql.NVarChar, item.einheit)
          .input('laden', sql.NVarChar, item.laden || null)
          .input('datum', sql.DateTime2, item.datum ? new Date(item.datum) : null)
          .input('uid', sql.Int, userId)
          .input('hid', sql.Int, hid)
          .query('INSERT INTO Artikel (Artikel, Menge, Einheit, Laden, Datum, BenutzerId, HaushaltId) OUTPUT INSERTED.Id, INSERTED.ErstelltAm VALUES (@artikel, @menge, @einheit, @laden, @datum, @uid, @hid)');
        const row = result.recordset[0];
        results.push({ id: row.Id, erstelltAm: row.ErstelltAm.toISOString() });
      }
      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
    res.ok({ inserted: results });
  } catch (err) {
    console.error('artikel bulk post error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const { artikel, menge, einheit, laden, datum, gekauft } = req.body;
    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';
    const request = db.request()
      .input('id', sql.Int, id)
      .input('artikel', sql.NVarChar, artikel)
      .input('menge', sql.Decimal(18, 2), menge)
      .input('einheit', sql.NVarChar, einheit)
      .input('laden', sql.NVarChar, laden || null)
      .input('datum', sql.DateTime2, datum ? new Date(datum) : null)
      .input('gekauft', sql.Bit, gekauft ? true : false);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`UPDATE Artikel SET Artikel=@artikel, Menge=@menge, Einheit=@einheit, Laden=@laden, Datum=@datum, Gekauft=@gekauft WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.ok();
    else res.fail(404, 'Nicht gefunden');
  } catch (err) {
    console.error('artikel put error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function deleteGekauft(req, res) {
  try {
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const where = hid != null ? 'Gekauft=1 AND HaushaltId=@hid' : 'Gekauft=1 AND BenutzerId=@uid';
    const request = db.request();
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`DELETE FROM Artikel WHERE ${where}`);
    res.ok({ deleted: result.rowsAffected[0] });
  } catch (err) {
    console.error('artikel delete gekauft error:', err);
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

    const result = await request.query(`DELETE FROM Artikel WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.ok();
    else res.fail(404, 'Nicht gefunden');
  } catch (err) {
    console.error('artikel delete error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

module.exports = {
  getAll,
  create,
  bulkCreate,
  update,
  deleteGekauft,
  remove
};
