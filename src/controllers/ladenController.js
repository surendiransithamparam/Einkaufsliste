const { getPool, sql } = require('../config/db');

async function getAll(req, res) {
  try {
    const db = await getPool();
    const result = await db.request()
      .query('SELECT Id, Name FROM Laden ORDER BY Name');
    res.ok(result.recordset.map(r => ({ id: r.Id, name: r.Name })));
  } catch (err) {
    console.error('laden error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

module.exports = { getAll };
