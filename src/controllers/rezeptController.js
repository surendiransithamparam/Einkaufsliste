const { parseBettyBossi, parseJsonLdRecipes, parseChefkoch, parseGuteKueche, parseGenericRecipeLinks, parseZutat, decodeHTMLEntities, allowedRecipeHosts } = require('../services/recipeScraper');

async function suche(req, res) {
  try {
    const q = req.query.q || '';
    const eq = encodeURIComponent(q);
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    const sources = [
      { name: 'Betty Bossi', url: `https://www.bettybossi.ch/de/rezepte/?query=${eq}&filters=rezepte`, parser: (html) => parseBettyBossi(html) },
      { name: 'Migusto', url: `https://migusto.migros.ch/de/suche?query=${eq}`, parser: (html) => parseJsonLdRecipes(html, 'https://migusto.migros.ch') },
      { name: 'Fooby', url: `https://fooby.ch/de/suche?query=${eq}`, parser: (html) => parseJsonLdRecipes(html, 'https://fooby.ch') },
      { name: 'Chefkoch', url: `https://www.chefkoch.de/rs/s0/${eq}/Rezepte.html`, parser: (html) => parseChefkoch(html) },
      { name: 'Swissmilk', url: `https://www.swissmilk.ch/de/rezepte-kochideen/?search=${eq}`, parser: (html) => parseJsonLdRecipes(html, 'https://www.swissmilk.ch') },
      { name: 'GuteKüche', url: `https://www.gutekueche.ch/search?search=${eq}`, parser: (html) => parseGuteKueche(html) },
      { name: 'Veg Recipes of India', url: `https://www.vegrecipesofindia.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://www.vegrecipesofindia.com', 'Veg Recipes of India') },
      { name: 'Indian Healthy Recipes', url: `https://www.indianhealthyrecipes.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://www.indianhealthyrecipes.com', 'Indian Healthy Recipes') },
      { name: 'Cook with Pranji', url: `https://cookwithpranji.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://cookwithpranji.com', 'Cook with Pranji') },
      { name: 'Padhuskitchen', url: `https://www.padhuskitchen.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://www.padhuskitchen.com', 'Padhuskitchen') },
      { name: 'Hebbars Kitchen', url: `https://hebbarskitchen.com/?s=${eq}`, parser: (html) => parseGenericRecipeLinks(html, 'https://hebbarskitchen.com', 'Hebbars Kitchen') },
    ];

    const allResults = [];

    await Promise.all(sources.map(async (s) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(s.url, {
          headers: { 'User-Agent': userAgent },
          signal: controller.signal
        });
        clearTimeout(timeout);
        const html = await response.text();
        const items = s.parser(html);
        for (const item of items.slice(0, 5)) {
          allResults.push(item);
        }
      } catch {}
    }));

    res.ok(allResults);
  } catch (err) {
    console.error('rezept suche error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

async function zutaten(req, res) {
  try {
    const url = req.query.url || '';
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.fail(400, 'URL nicht erlaubt.');
    }

    if ((parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') ||
        !allowedRecipeHosts.has(parsedUrl.hostname)) {
      return res.fail(400, 'URL nicht erlaubt.');
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await response.text();

    const zutatenList = [];

    const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;
    let jm;
    while ((jm = jsonLdPattern.exec(html)) !== null) {
      try {
        const doc = JSON.parse(jm[1]);
        if (doc.recipeIngredient) {
          for (const ing of doc.recipeIngredient) {
            const text = (ing || '').trim();
            if (!text) continue;
            parseZutat(text, zutatenList);
          }
          return res.ok(zutatenList);
        }
      } catch {}
    }

    const ingPattern = /(\d+[\.,]?\d*)\s*(g|kg|ml|dl|l|EL|TL|Stück|Prise|Bund|Packung|Pack\.)?\s+(.+?)(?:<|$)/gi;
    let im;
    while ((im = ingPattern.exec(html)) !== null) {
      const mengeStr = im[1].replace(',', '.');
      const menge = parseFloat(mengeStr) || 1;
      const einheit = im[2] || 'Stück';
      const artikel = decodeHTMLEntities(im[3].trim());
      zutatenList.push({ menge, einheit, artikel });
    }

    res.ok(zutatenList);
  } catch (err) {
    console.error('rezept zutaten error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

module.exports = { suche, zutaten };
