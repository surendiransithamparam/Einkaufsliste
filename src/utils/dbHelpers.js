const { sql } = require('../config/db');

async function getHaushaltId(userId, pool) {
  const result = await pool.request()
    .input('uid', sql.Int, userId)
    .query('SELECT HaushaltId FROM Benutzer WHERE Id=@uid');
  const row = result.recordset[0];
  return row && row.HaushaltId != null ? row.HaushaltId : null;
}

async function getHaushaltRolle(userId, pool) {
  const result = await pool.request()
    .input('uid', sql.Int, userId)
    .query('SELECT HaushaltRolle FROM Benutzer WHERE Id=@uid');
  const row = result.recordset[0];
  return row && row.HaushaltRolle ? row.HaushaltRolle : 'schreibend';
}

async function canWrite(userId, pool) {
  const rolle = await getHaushaltRolle(userId, pool);
  return rolle !== 'lesend';
}

async function isAdmin(userId, pool) {
  const result = await pool.request()
    .input('uid', sql.Int, userId)
    .query('SELECT IsAdmin FROM Benutzer WHERE Id=@uid');
  const row = result.recordset[0];
  return row && row.IsAdmin === true;
}

async function deleteHaushaltCascade(hid, db) {
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Wochenplan WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM GerichtZutat WHERE GerichtId IN (SELECT Id FROM Gericht WHERE HaushaltId=@hid)');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Gericht WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('UPDATE Artikel SET HaushaltId=NULL WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Favorit WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Kundenkarte WHERE HaushaltId=@hid');
  await db.request().input('hid', sql.Int, hid)
    .query('DELETE FROM Haushalt WHERE Id=@hid');
}

module.exports = {
  getHaushaltId,
  getHaushaltRolle,
  canWrite,
  isAdmin,
  deleteHaushaltCascade
};
