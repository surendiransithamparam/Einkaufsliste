const { getPool, sql } = require('../config/db');
const { getHaushaltId } = require('../utils/dbHelpers');
const { fetchAllAktionen, matchAktion, resetCache } = require('../services/aktionenScraper');

async function search(req, res) {
  try {
    const suche = (req.query.suche || '').trim();
    const laden = (req.query.laden || '').trim();
    const aktionen = await fetchAllAktionen();

    let filtered = aktionen;
    if (suche) {
      filtered = matchAktion(suche, filtered);
    }
    if (laden) {
      filtered = filtered.filter(a => a.laden.toLowerCase() === laden.toLowerCase());
    }
    res.json(filtered.slice(0, 50));
  } catch (err) {
    console.error('aktionen error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function match(req, res) {
  try {
    const userId = req.session.userId;
    const db = await getPool();
    const hid = await getHaushaltId(userId, db);

    let artikelResult;
    if (hid != null) {
      artikelResult = await db.request()
        .input('hid', sql.Int, hid)
        .query('SELECT Id, Artikel FROM Artikel WHERE HaushaltId=@hid AND Gekauft=0');
    } else {
      artikelResult = await db.request()
        .input('uid', sql.Int, userId)
        .query('SELECT Id, Artikel FROM Artikel WHERE BenutzerId=@uid AND HaushaltId IS NULL AND Gekauft=0');
    }

    const aktionen = await fetchAllAktionen();
    const matches = {};

    for (const row of artikelResult.recordset) {
      const found = matchAktion(row.Artikel, aktionen);
      if (found.length > 0) {
        matches[row.Id] = found;
      }
    }

    res.json(matches);
  } catch (err) {
    console.error('aktionen match error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function alle(req, res) {
  try {
    const aktionen = await fetchAllAktionen();
    const byLaden = {};
    for (const a of aktionen) {
      if (!byLaden[a.laden]) byLaden[a.laden] = [];
      byLaden[a.laden].push(a);
    }
    res.json({ total: aktionen.length, byLaden });
  } catch (err) {
    console.error('aktionen alle error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

async function refresh(req, res) {
  try {
    resetCache();
    const aktionen = await fetchAllAktionen();
    res.json({ total: aktionen.length });
  } catch (err) {
    console.error('aktionen refresh error:', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
}

module.exports = { search, match, alle, refresh };
