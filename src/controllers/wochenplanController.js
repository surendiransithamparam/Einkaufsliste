const { getPool, sql } = require('../config/db');
const { getHaushaltId, canWrite } = require('../utils/dbHelpers');

async function getAll(req, res) {
  try {
    const woche = req.query.woche;
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    const where = hid != null ? 'HaushaltId=@hid' : 'BenutzerId=@uid AND HaushaltId IS NULL';
    const request = db.request().input('woche', sql.DateTime2, new Date(woche));
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    const result = await request.query(`SELECT Id, Tag, Mahlzeit, Rezept, Erwachsene, Kinder FROM Wochenplan WHERE Woche=@woche AND ${where} ORDER BY Tag, Mahlzeit`);
    res.json(result.recordset.map(r => ({
      id: r.Id, tag: r.Tag, mahlzeit: r.Mahlzeit, rezept: r.Rezept, erwachsene: r.Erwachsene, kinder: r.Kinder
    })));
  } catch (err) {
    console.error('wochenplan get error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function upsert(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    if (!await canWrite(userId, db)) return res.status(403).json({});
    const hid = await getHaushaltId(userId, db);

    const { woche, tag, mahlzeit, rezept, erwachsene, kinder } = req.body;
    const mergeOn = hid != null
      ? 't.Woche=s.Woche AND t.Tag=s.Tag AND t.Mahlzeit=s.Mahlzeit AND t.HaushaltId=@hid'
      : 't.Woche=s.Woche AND t.Tag=s.Tag AND t.Mahlzeit=s.Mahlzeit AND t.BenutzerId=s.BenutzerId';
    await db.request()
      .input('woche', sql.DateTime2, new Date(woche))
      .input('tag', sql.Int, tag)
      .input('mahlzeit', sql.NVarChar, mahlzeit)
      .input('rezept', sql.NVarChar, rezept)
      .input('erw', sql.Int, erwachsene != null ? erwachsene : 2)
      .input('kind', sql.Int, kinder != null ? kinder : 0)
      .input('uid', sql.Int, userId)
      .input('hid', sql.Int, hid)
      .query(`MERGE Wochenplan AS t
              USING (SELECT @woche AS Woche, @tag AS Tag, @mahlzeit AS Mahlzeit, @uid AS BenutzerId) AS s
              ON ${mergeOn}
              WHEN MATCHED THEN UPDATE SET Rezept=@rezept, Erwachsene=@erw, Kinder=@kind
              WHEN NOT MATCHED THEN INSERT (Woche,Tag,Mahlzeit,Rezept,Erwachsene,Kinder,BenutzerId,HaushaltId) VALUES (@woche,@tag,@mahlzeit,@rezept,@erw,@kind,@uid,@hid);`);
    res.json({});
  } catch (err) {
    console.error('wochenplan post error:', err);
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

    const where = hid != null ? 'Id=@id AND HaushaltId=@hid' : 'Id=@id AND BenutzerId=@uid';
    const request = db.request().input('id', sql.Int, id);
    if (hid != null) request.input('hid', sql.Int, hid);
    else request.input('uid', sql.Int, userId);

    await request.query(`DELETE FROM Wochenplan WHERE ${where}`);
    res.json({});
  } catch (err) {
    console.error('wochenplan delete error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

module.exports = { getAll, upsert, remove };
