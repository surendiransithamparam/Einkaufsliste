const { getPool, sql } = require('../config/db');
const { generateCode } = require('../utils/crypto');
const { getHaushaltId, deleteHaushaltCascade } = require('../utils/dbHelpers');

async function create(req, res) {
  try {
    const userId = req.session.userId;
    const name = (req.body.name || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Name muss mindestens 2 Zeichen haben.' });

    const db = await getPool();
    const existingHid = await getHaushaltId(userId, db);
    if (existingHid != null) return res.status(400).json({ error: 'Du bist bereits in einem Haushalt.' });

    const code = generateCode();
    const result = await db.request()
      .input('name', sql.NVarChar, name)
      .input('code', sql.NVarChar, code)
      .input('uid', sql.Int, userId)
      .query('INSERT INTO Haushalt (Name, Code, ErstelltVon) OUTPUT INSERTED.Id VALUES (@name, @code, @uid)');
    const haushaltId = result.recordset[0].Id;

    await db.request()
      .input('hid', sql.Int, haushaltId)
      .input('uid', sql.Int, userId)
      .query("UPDATE Benutzer SET HaushaltId=@hid, HaushaltRolle='admin' WHERE Id=@uid");

    await db.request()
      .input('hid', sql.Int, haushaltId)
      .input('uid', sql.Int, userId)
      .query('UPDATE Artikel SET HaushaltId=@hid WHERE BenutzerId=@uid AND HaushaltId IS NULL');

    res.json({ id: haushaltId, name, code });
  } catch (err) {
    console.error('haushalt create error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function join(req, res) {
  try {
    const userId = req.session.userId;
    const code = (req.body.code || '').trim().toUpperCase();

    const db = await getPool();
    const existingHid = await getHaushaltId(userId, db);
    if (existingHid != null) return res.status(400).json({ error: 'Du bist bereits in einem Haushalt. Zuerst verlassen.' });

    const find = await db.request()
      .input('code', sql.NVarChar, code)
      .query('SELECT Id, Name FROM Haushalt WHERE Code=@code');
    if (find.recordset.length === 0) return res.status(404).json({ error: 'Haushalt nicht gefunden.' });

    const haushaltId = find.recordset[0].Id;
    const haushaltName = find.recordset[0].Name;

    await db.request()
      .input('hid', sql.Int, haushaltId)
      .input('uid', sql.Int, userId)
      .query("UPDATE Benutzer SET HaushaltId=@hid, HaushaltRolle='schreibend' WHERE Id=@uid");

    await db.request()
      .input('hid', sql.Int, haushaltId)
      .input('uid', sql.Int, userId)
      .query('UPDATE Artikel SET HaushaltId=@hid WHERE BenutzerId=@uid AND HaushaltId IS NULL');

    res.json({ id: haushaltId, name: haushaltName });
  } catch (err) {
    console.error('haushalt join error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function leave(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    await db.request()
      .input('uid', sql.Int, userId)
      .query("UPDATE Benutzer SET HaushaltId=NULL, HaushaltRolle='schreibend' WHERE Id=@uid");

    await db.request()
      .input('uid', sql.Int, userId)
      .query('UPDATE Artikel SET HaushaltId=NULL WHERE BenutzerId=@uid');

    if (hid != null) {
      const count = await db.request()
        .input('hid', sql.Int, hid)
        .query('SELECT COUNT(*) AS cnt FROM Benutzer WHERE HaushaltId=@hid');
      if (count.recordset[0].cnt === 0) {
        await deleteHaushaltCascade(hid, db);
      }
    }

    res.json({});
  } catch (err) {
    console.error('haushalt leave error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function getMitglieder(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);
    if (hid == null) return res.json([]);

    let erstelltVon = null;
    const hvResult = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT ErstelltVon FROM Haushalt WHERE Id=@hid');
    if (hvResult.recordset.length > 0 && hvResult.recordset[0].ErstelltVon != null) {
      erstelltVon = hvResult.recordset[0].ErstelltVon;
    }

    const result = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT Id, Benutzername, HaushaltRolle FROM Benutzer WHERE HaushaltId=@hid');

    const members = result.recordset.map(r => ({
      id: r.Id,
      benutzername: r.Benutzername,
      rolle: r.HaushaltRolle,
      isErsteller: erstelltVon != null && r.Id === erstelltVon
    }));
    res.json(members);
  } catch (err) {
    console.error('mitglieder error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function rename(req, res) {
  try {
    const userId = req.session.userId;
    const name = (req.body.name || '').trim();
    if (!name || name.length < 2) return res.status(400).json({ error: 'Name muss mindestens 2 Zeichen haben.' });

    const db = await getPool();
    const hid = await getHaushaltId(userId, db);
    if (hid == null) return res.status(400).json({ error: 'Du bist in keinem Haushalt.' });

    const check = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT ErstelltVon FROM Haushalt WHERE Id=@hid');
    const creatorId = check.recordset[0]?.ErstelltVon;
    if (creatorId == null || creatorId !== userId) return res.status(403).json({ error: 'Nur der Ersteller kann den Haushalt umbenennen.' });

    await db.request()
      .input('name', sql.NVarChar, name)
      .input('hid', sql.Int, hid)
      .query('UPDATE Haushalt SET Name=@name WHERE Id=@hid');
    res.json({});
  } catch (err) {
    console.error('haushalt rename error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function updateRolle(req, res) {
  try {
    const userId = req.session.userId;
    const targetUserId = req.body.userId;
    const rolle = (req.body.rolle || '').trim();
    if (rolle !== 'schreibend' && rolle !== 'lesend')
      return res.status(400).json({ error: 'Ungültige Rolle.' });

    const db = await getPool();
    const hid = await getHaushaltId(userId, db);
    if (hid == null) return res.status(400).json({ error: 'Du bist in keinem Haushalt.' });

    const check = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT ErstelltVon FROM Haushalt WHERE Id=@hid');
    const creatorId = check.recordset[0]?.ErstelltVon;
    if (creatorId == null || creatorId !== userId) return res.status(403).json({});

    if (targetUserId === userId)
      return res.status(400).json({ error: 'Du kannst deine eigene Rolle nicht ändern.' });

    const update = await db.request()
      .input('rolle', sql.NVarChar, rolle)
      .input('tid', sql.Int, targetUserId)
      .input('hid', sql.Int, hid)
      .query('UPDATE Benutzer SET HaushaltRolle=@rolle WHERE Id=@tid AND HaushaltId=@hid');
    if (update.rowsAffected[0] > 0) res.json({});
    else res.status(404).json({});
  } catch (err) {
    console.error('rolle error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

module.exports = {
  create,
  join,
  leave,
  getMitglieder,
  rename,
  updateRolle
};
