const { sql } = require('../config/db');
const { generateCode } = require('../utils/crypto');
const { deleteHaushaltCascade } = require('../utils/dbHelpers');

async function create(req, res) {
  try {
    const { userId, hid: existingHid, db } = req.ctx;
    const name = (req.body.name || '').trim();
    if (name.length < 2) return res.fail(400, 'Name muss mindestens 2 Zeichen haben.');

    if (existingHid != null) return res.fail(400, 'Du bist bereits in einem Haushalt.');

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

    res.ok({ id: haushaltId, name, code });
  } catch (err) {
    console.error('haushalt create error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function join(req, res) {
  try {
    const { userId, hid: existingHid, db } = req.ctx;
    const code = (req.body.code || '').trim().toUpperCase();

    if (existingHid != null) return res.fail(400, 'Du bist bereits in einem Haushalt. Zuerst verlassen.');

    const find = await db.request()
      .input('code', sql.NVarChar, code)
      .query('SELECT Id, Name FROM Haushalt WHERE Code=@code');
    if (find.recordset.length === 0) return res.fail(404, 'Haushalt nicht gefunden.');

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

    res.ok({ id: haushaltId, name: haushaltName });
  } catch (err) {
    console.error('haushalt join error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function leave(req, res) {
  try {
    const { userId, hid, db } = req.ctx;

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

    res.ok();
  } catch (err) {
    console.error('haushalt leave error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function getMitglieder(req, res) {
  try {
    const { hid, db } = req.ctx;
    if (hid == null) return res.ok([]);

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
    res.ok(members);
  } catch (err) {
    console.error('mitglieder error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function rename(req, res) {
  try {
    const { userId, hid, db } = req.ctx;
    const name = (req.body.name || '').trim();
    if (!name || name.length < 2) return res.fail(400, 'Name muss mindestens 2 Zeichen haben.');

    if (hid == null) return res.fail(400, 'Du bist in keinem Haushalt.');

    const check = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT ErstelltVon FROM Haushalt WHERE Id=@hid');
    const creatorId = check.recordset[0]?.ErstelltVon;
    if (creatorId == null || creatorId !== userId) return res.fail(403, 'Nur der Ersteller kann den Haushalt umbenennen.');

    await db.request()
      .input('name', sql.NVarChar, name)
      .input('hid', sql.Int, hid)
      .query('UPDATE Haushalt SET Name=@name WHERE Id=@hid');
    res.ok();
  } catch (err) {
    console.error('haushalt rename error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function updateRolle(req, res) {
  try {
    const { userId, hid, db } = req.ctx;
    const targetUserId = req.body.userId;
    const rolle = (req.body.rolle || '').trim();
    if (rolle !== 'schreibend' && rolle !== 'lesend')
      return res.fail(400, 'Ungültige Rolle.');

    if (hid == null) return res.fail(400, 'Du bist in keinem Haushalt.');

    const check = await db.request()
      .input('hid', sql.Int, hid)
      .query('SELECT ErstelltVon FROM Haushalt WHERE Id=@hid');
    const creatorId = check.recordset[0]?.ErstelltVon;
    if (creatorId == null || creatorId !== userId) return res.status(403).json({});

    if (targetUserId === userId)
      return res.fail(400, 'Du kannst deine eigene Rolle nicht ändern.');

    const update = await db.request()
      .input('rolle', sql.NVarChar, rolle)
      .input('tid', sql.Int, targetUserId)
      .input('hid', sql.Int, hid)
      .query('UPDATE Benutzer SET HaushaltRolle=@rolle WHERE Id=@tid AND HaushaltId=@hid');
    if (update.rowsAffected[0] > 0) res.ok();
    else res.fail(404, 'Nicht gefunden');
  } catch (err) {
    console.error('rolle error:', err);
    res.fail(500, 'Interner Fehler.');
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
