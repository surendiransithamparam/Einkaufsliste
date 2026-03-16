const { getPool, sql } = require('../config/db');

async function getAll(req, res) {
  try {
    const db = await getPool();
    const result = await db.request()
      .query('SELECT Id, Name FROM Laden ORDER BY Name');
    res.json(result.recordset.map(r => ({ id: r.Id, name: r.Name })));
  } catch (err) {
    console.error('laden error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

module.exports = { getAll };
