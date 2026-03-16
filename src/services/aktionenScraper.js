const { decodeHTMLEntities } = require('./recipeScraper');

const AKTIONEN_CACHE = {
  data: [],
  lastFetch: 0,
  ttlMs: 4 * 60 * 60 * 1000 // 4 hours
};

const AKTIONEN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchAllAktionen() {
  const now = Date.now();
  if (AKTIONEN_CACHE.data.length > 0 && (now - AKTIONEN_CACHE.lastFetch) < AKTIONEN_CACHE.ttlMs) {
    return AKTIONEN_CACHE.data;
  }

  console.log('Aktionen: Fetching promotions from all stores...');
  const results = [];

  const fetchers = [
    fetchDennerAktionenAPI,
    fetchAktionisDeals,
  ];

  await Promise.all(fetchers.map(async (fn) => {
    try {
      const items = await fn();
      results.push(...items);
    } catch (e) {
      console.error(`Aktionen: ${fn.name} failed:`, e.message);
    }
  }));

  AKTIONEN_CACHE.data = results;
  AKTIONEN_CACHE.lastFetch = now;
  console.log(`Aktionen: ${results.length} promotions cached`);
  return results;
}

async function fetchDennerAktionenAPI() {
  const items = [];
  try {
    const controller1 = new AbortController();
    const timeout1 = setTimeout(() => controller1.abort(), 10000);
    const filtersRes = await fetch('https://denner-mobile-api.detailnet.ch/v2/online-filters', {
      headers: { 'Accept': 'application/json', 'Accept-Language': 'de' },
      signal: controller1.signal
    });
    clearTimeout(timeout1);
    if (!filtersRes.ok) throw new Error(`Denner filters: ${filtersRes.status}`);
    const filtersData = await filtersRes.json();
    const filters = (filtersData.online_filters || []).filter(f =>
      !f.title.toLowerCase().includes('tabak')
    );

    await Promise.all(filters.map(async (filter) => {
      try {
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 15000);
        const pubRes = await fetch(
          `https://denner-mobile-api.detailnet.ch/v2/online-filters/${filter.id}/online-publications`,
          {
            headers: { 'Accept': 'application/json', 'Accept-Language': 'de' },
            signal: controller2.signal
          }
        );
        clearTimeout(timeout2);
        if (!pubRes.ok) return;
        const pubData = await pubRes.json();

        for (const pub of (pubData.online_publications || [])) {
          for (const article of (pub.articles || [])) {
            const prices = article.prices || {};
            items.push({
              name: article.title || '',
              beschreibung: article.description || '',
              preis: prices.sales || null,
              originalPreis: prices.instead || null,
              rabatt: article.stopper?.text || null,
              laden: 'Denner',
              kategorie: filter.title,
              gueltigVon: article.validity?.from || null,
              gueltigBis: article.validity?.to || null,
              bild: article.packshot?.cdn_url || null,
              url: null
            });
          }
        }
      } catch (e) {
        console.error(`Aktionen Denner filter ${filter.title}:`, e.message);
      }
    }));
  } catch (e) {
    console.error('Aktionen Denner API:', e.message);
  }
  console.log(`Aktionen Denner: ${items.length} articles`);
  return items;
}

async function fetchAktionisDeals() {
  const items = [];
  const vendors = [
    { slug: 'migros', laden: 'Migros' },
    { slug: 'coop', laden: 'Coop' },
    { slug: 'coop-megastore', laden: 'Coop Megastore' },
    { slug: 'lidl', laden: 'Lidl' },
    { slug: 'aldi-suisse', laden: 'Aldi' },
    { slug: 'denner', laden: 'Denner' },
    { slug: 'otto-s', laden: "OTTO'S" },
    { slug: 'spar', laden: 'SPAR' },
    { slug: 'volg', laden: 'Volg' },
  ];

  await Promise.all(vendors.map(async ({ slug, laden }) => {
    try {
      for (let page = 1; page <= 2; page++) {
        const url = page === 1
          ? `https://www.aktionis.ch/vendors/${slug}`
          : `https://www.aktionis.ch/vendors/${slug}?page=${page}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
          headers: { 'User-Agent': AKTIONEN_UA, 'Accept': 'text/html' },
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) break;
        const html = await res.text();

        const dealPattern = /<a[^>]*class="[^"]*deal[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let dm;
        while ((dm = dealPattern.exec(html)) !== null && items.length < 500) {
          const block = dm[2];
          const dealUrl = dm[1];

          const nameMatch = block.match(/<(?:h[2-5]|span|div|p)[^>]*class="[^"]*(?:title|name|heading)[^"]*"[^>]*>([^<]{3,120})/i)
            || block.match(/<h[2-5][^>]*>([^<]{3,120})<\/h[2-5]>/i);

          const priceMatch = block.match(/(?:class="[^"]*(?:new|sale|current)[^"]*"[^>]*>)[^<]*?(\d+\.\d{2})/i)
            || block.match(/(\d+\.\d{2})/);
          const oldPriceMatch = block.match(/(?:class="[^"]*(?:old|original|strike|was)[^"]*"[^>]*>)[^<]*?(\d+\.\d{2})/i)
            || block.match(/(?:statt|alt|was)\s*(?:CHF\s*)?(\d+\.\d{2})/i);

          const discountMatch = block.match(/(-?\d+)\s*%/);
          const imgMatch = block.match(/<img[^>]*src="([^"]+)"/i);

          if (nameMatch) {
            const name = decodeHTMLEntities(nameMatch[1].trim());
            if (name.length > 2) {
              items.push({
                name,
                beschreibung: '',
                preis: priceMatch ? parseFloat(priceMatch[1]) : null,
                originalPreis: oldPriceMatch ? parseFloat(oldPriceMatch[1]) : null,
                rabatt: discountMatch ? `${discountMatch[1]}%` : null,
                laden,
                kategorie: null,
                gueltigVon: null,
                gueltigBis: null,
                bild: imgMatch ? imgMatch[1] : null,
                url: dealUrl ? (dealUrl.startsWith('http') ? dealUrl : `https://www.aktionis.ch${dealUrl}`) : null
              });
            }
          }
        }

        if (items.filter(i => i.laden === laden).length === 0) {
          const cardPattern = /<div[^>]*class="[^"]*card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
          let cm;
          while ((cm = cardPattern.exec(html)) !== null && items.length < 500) {
            const block = cm[1];
            const nameMatch = block.match(/<(?:h[2-5]|span|strong)[^>]*>([^<]{3,100})<\//i);
            const priceMatch = block.match(/(\d+\.\d{2})/);
            const discountMatch = block.match(/(-?\d+)\s*%/);

            if (nameMatch && (priceMatch || discountMatch)) {
              const name = decodeHTMLEntities(nameMatch[1].trim());
              if (name.length > 2 && !/^\d/.test(name)) {
                items.push({
                  name,
                  beschreibung: '',
                  preis: priceMatch ? parseFloat(priceMatch[1]) : null,
                  originalPreis: null,
                  rabatt: discountMatch ? `${discountMatch[1]}%` : null,
                  laden,
                  kategorie: null,
                  gueltigVon: null,
                  gueltigBis: null,
                  bild: null,
                  url: null
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.error(`Aktionen Aktionis ${laden}:`, e.message);
    }
  }));

  console.log(`Aktionen Aktionis.ch: ${items.length} deals (${vendors.map(v => `${v.laden}: ${items.filter(i => i.laden === v.laden).length}`).join(', ')})`);
  return items;
}

function matchAktion(artikelName, aktionen) {
  if (!artikelName || artikelName.length < 2) return [];
  const searchTerms = artikelName.toLowerCase()
    .replace(/[äöü]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue' }[c]))
    .split(/\s+/)
    .filter(t => t.length > 2);
  const searchLower = artikelName.toLowerCase();

  return aktionen.filter(a => {
    const name = a.name.toLowerCase();
    if (name.includes(searchLower)) return true;
    if (searchTerms.length > 0 && searchTerms.every(t => name.includes(t))) return true;
    const aktionTerms = name.split(/\s+/).filter(t => t.length > 2);
    if (aktionTerms.some(t => searchLower.includes(t) && t.length > 3)) return true;
    return false;
  }).slice(0, 5);
}

function resetCache() {
  AKTIONEN_CACHE.lastFetch = 0;
}

module.exports = {
  fetchAllAktionen,
  matchAktion,
  resetCache
};
