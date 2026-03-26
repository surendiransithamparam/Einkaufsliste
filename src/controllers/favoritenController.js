const { sql } = require('../config/db');

async function getAll(req, res) {
  try {
    const { userId, hid, db } = req.ctx;

    const where = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request();
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT Id, Name, Url, Quelle, EigenGerichtId FROM Favorit WHERE ${where} ORDER BY Name`);
    res.ok(result.recordset.map(r => ({
      id: r.Id,
      name: r.Name,
      url: r.Url || null,
      quelle: r.Quelle || null,
      eigenGerichtId: r.EigenGerichtId || null
    })));
  } catch (err) {
    console.error('favoriten get error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function create(req, res) {
  try {
    const { userId, hid, canWrite, db } = req.ctx;
    const name = (req.body.name || '').trim();
    if (name.length < 1) return res.fail(400, 'Name ist erforderlich.');

    const url = req.body.url ? req.body.url.trim() : null;
    const quelle = req.body.quelle ? req.body.quelle.trim() : null;
    const eigenGerichtId = (req.body.eigenGerichtId != null && typeof req.body.eigenGerichtId === 'number') ? req.body.eigenGerichtId : null;

    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const whereCheck = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    let dupSql;
    if (url) {
      dupSql = `SELECT COUNT(*) AS cnt FROM Favorit WHERE ${whereCheck} AND Url=@url`;
    } else if (eigenGerichtId != null) {
      dupSql = `SELECT COUNT(*) AS cnt FROM Favorit WHERE ${whereCheck} AND EigenGerichtId=@eid`;
    } else {
      dupSql = `SELECT COUNT(*) AS cnt FROM Favorit WHERE ${whereCheck} AND Name=@name AND Url IS NULL AND EigenGerichtId IS NULL`;
    }

    const dupRequest = db.request();
    if (hid != null) dupRequest.input('hid', sql.Int, hid);
    else dupRequest.input('uid', sql.Int, userId);
    if (url) dupRequest.input('url', sql.NVarChar, url);
    if (eigenGerichtId != null) dupRequest.input('eid', sql.Int, eigenGerichtId);
    dupRequest.input('name', sql.NVarChar, name);

    const dupResult = await dupRequest.query(dupSql);
    if (dupResult.recordset[0].cnt > 0) return res.ok({ duplicate: true });

    const result = await db.request()
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .input('name', sql.NVarChar, name)
      .input('url', sql.NVarChar, url)
      .input('quelle', sql.NVarChar, quelle)
      .input('eid', sql.Int, eigenGerichtId)
      .query('INSERT INTO Favorit (BenutzerId, HaushaltId, Name, Url, Quelle, EigenGerichtId) OUTPUT INSERTED.Id VALUES (@uid, @hid, @name, @url, @quelle, @eid)');
    res.ok({ id: result.recordset[0].Id });
  } catch (err) {
    console.error('favoriten post error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { userId, hid, canWrite, db } = req.ctx;
    if (!canWrite) return res.fail(403, 'Keine Schreibberechtigung');

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`DELETE FROM Favorit WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.ok();
    else res.fail(404, 'Nicht gefunden');
  } catch (err) {
    console.error('favoriten delete error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

module.exports = { getAll, create, remove };
