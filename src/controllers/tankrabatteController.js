const { scrapePreispirat, scrapeShellCh } = require('../services/tankrabatteScraper');

let tankrabatteCache = { data: null, timestamp: 0 };
const TANKRABATTE_CACHE_TTL = 60 * 60 * 1000;

async function getTankrabatte(req, res) {
  try {
    if (tankrabatteCache.data && Date.now() - tankrabatteCache.timestamp < TANKRABATTE_CACHE_TTL) {
      return res.ok(tankrabatteCache.data);
    }

    const [coopPronto, migrol, shell] = await Promise.all([
      scrapePreispirat('coop-pronto'),
      scrapePreispirat('migrol'),
      scrapeShellCh()
    ]);

    const avia = [{
      titel: 'AVIA Karte: 4-5 Rp./Liter Rabatt an allen AVIA-Stationen',
      url: 'https://avia.ch',
      rabatt: '4-5 Rp./L',
      abgelaufen: false,
      details: 'Dauerhaft mit AVIA-Karte'
    }];

    const data = { coopPronto, migrol, shell, avia };
    tankrabatteCache = { data, timestamp: Date.now() };
    res.ok(data);
  } catch (e) {
    console.error('Tankrabatte Fehler:', e);
    res.fail(500, 'Fehler beim Laden der Tankrabatte.');
  }
}

module.exports = { getTankrabatte };
