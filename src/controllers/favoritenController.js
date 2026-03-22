const { getPool, sql } = require('../config/db');
const { getHaushaltId, canWrite } = require('../utils/dbHelpers');

async function getAll(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request();
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT Id, Name, Url, Quelle, EigenGerichtId FROM Favorit WHERE ${where} ORDER BY Name`);
    res.json(result.recordset.map(r => ({
      id: r.Id,
      name: r.Name,
      url: r.Url || null,
      quelle: r.Quelle || null,
      eigenGerichtId: r.EigenGerichtId || null
    })));
  } catch (err) {
    console.error('favoriten get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function create(req, res) {
  try {
    const userId = req.session.userId;
    const name = (req.body.name || '').trim();
    if (name.length < 1) return res.status(400).json({ error: 'Name ist erforderlich.' });

    const url = req.body.url ? req.body.url.trim() : null;
    const quelle = req.body.quelle ? req.body.quelle.trim() : null;
    const eigenGerichtId = (req.body.eigenGerichtId != null && typeof req.body.eigenGerichtId === 'number') ? req.body.eigenGerichtId : null;

    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

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
    if (dupResult.recordset[0].cnt > 0) return res.json({ duplicate: true });

    const result = await db.request()
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .input('name', sql.NVarChar, name)
      .input('url', sql.NVarChar, url)
      .input('quelle', sql.NVarChar, quelle)
      .input('eid', sql.Int, eigenGerichtId)
      .query('INSERT INTO Favorit (BenutzerId, HaushaltId, Name, Url, Quelle, EigenGerichtId) OUTPUT INSERTED.Id VALUES (@uid, @hid, @name, @url, @quelle, @eid)');
    res.json({ id: result.recordset[0].Id });
  } catch (err) {
    console.error('favoriten post error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id);
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`DELETE FROM Favorit WHERE ${where}`);
    if (result.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({});
  } catch (err) {
    console.error('favoriten delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

module.exports = { getAll, create, remove };
