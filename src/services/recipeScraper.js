const allowedRecipeHosts = new Set([
  'www.bettybossi.ch', 'bettybossi.ch',
  'migusto.migros.ch',
  'fooby.ch', 'www.fooby.ch',
  'www.chefkoch.de', 'chefkoch.de',
  'www.swissmilk.ch', 'swissmilk.ch',
  'www.gutekueche.ch', 'gutekueche.ch',
  'www.vegrecipesofindia.com', 'vegrecipesofindia.com',
  'www.indianhealthyrecipes.com', 'indianhealthyrecipes.com',
  'cookwithpranji.com', 'www.cookwithpranji.com',
  'www.padhuskitchen.com', 'padhuskitchen.com',
  'hebbarskitchen.com', 'www.hebbarskitchen.com'
]);

function toTitleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function parseBettyBossi(html) {
  const results = [];
  const linkPattern = /href="(\/de\/rezepte\/rezept\/[^"]+\/)"/gi;
  const seen = new Set();
  let m;
  while ((m = linkPattern.exec(html)) !== null) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    const slug = p.split('/').filter(s => s).pop() || '';
    let nameParts = slug.split('-');
    if (nameParts.length > 1 && /^\d+$/.test(nameParts[nameParts.length - 1])) {
      nameParts = nameParts.slice(0, -1);
    }
    let name = nameParts.join(' ').replace(/ae/g, 'ä').replace(/ue/g, 'ü').replace(/oe/g, 'ö');
    name = toTitleCase(name);
    results.push({ url: 'https://www.bettybossi.ch' + p, name, source: 'Betty Bossi' });
    if (results.length >= 5) break;
  }
  return results;
}

function parseJsonLdRecipes(html, baseUrl) {
  const results = [];
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;
  const linkPattern = /href="((?:\/[^"]*?)?\/rezept[^"]*?)"[^>]*>/gi;
  const hostName = new URL(baseUrl).host.replace('www.', '');

  let jm;
  while ((jm = jsonLdPattern.exec(html)) !== null) {
    try {
      const doc = JSON.parse(jm[1]);
      if (doc.itemListElement) {
        for (const item of doc.itemListElement) {
          let url = item.url || null;
          const name = item.name || null;
          if (url && name) {
            if (!url.startsWith('http')) url = baseUrl + url;
            results.push({ url, name, source: hostName });
          }
          if (results.length >= 5) return results;
        }
      }
      if (doc['@type'] === 'Recipe') {
        const url = doc.url || null;
        const name = doc.name || null;
        if (url && name) results.push({ url, name, source: hostName });
      }
    } catch {}
  }

  if (results.length === 0) {
    const seen = new Set();
    let lm;
    while ((lm = linkPattern.exec(html)) !== null) {
      const p = lm[1];
      if (seen.has(p)) continue;
      seen.add(p);
      const fullUrl = p.startsWith('http') ? p : baseUrl + p;
      const slug = p.split('/').filter(s => s).pop() || '';
      let name = slug.replace(/-/g, ' ');
      name = toTitleCase(name);
      if (name.length > 2) results.push({ url: fullUrl, name, source: hostName });
      if (results.length >= 5) break;
    }
  }
  return results;
}

function parseChefkoch(html) {
  const results = [];
  const pattern = /href="(https:\/\/www\.chefkoch\.de\/rezepte\/\d+\/[^"]+)"/gi;
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;

  let jm;
  while ((jm = jsonLdPattern.exec(html)) !== null) {
    try {
      const doc = JSON.parse(jm[1]);
      if (doc.itemListElement) {
        for (const item of doc.itemListElement) {
          const itemObj = item.item || item;
          const url = itemObj.url || null;
          const name = itemObj.name || null;
          if (url && name) results.push({ url, name, source: 'Chefkoch' });
          if (results.length >= 5) return results;
        }
      }
    } catch {}
  }

  if (results.length === 0) {
    const seen = new Set();
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const url = m[1];
      if (seen.has(url)) continue;
      seen.add(url);
      const slug = (url.split('/').pop() || '').replace('.html', '');
      let name = slug.replace(/-/g, ' ').replace(/_/g, ' ');
      name = toTitleCase(name);
      results.push({ url, name, source: 'Chefkoch' });
      if (results.length >= 5) break;
    }
  }
  return results;
}

function parseGuteKueche(html) {
  const results = [];
  const pattern = /href="(https:\/\/www\.gutekueche\.ch\/[^"]*-rezept-\d+)"/gi;
  const seen = new Set();
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    let slug = (url.split('/').pop() || '');
    slug = slug.replace(/-rezept-\d+$/, '');
    let name = slug.replace(/-/g, ' ');
    name = toTitleCase(name);
    results.push({ url, name, source: 'GuteKüche' });
    if (results.length >= 5) break;
  }
  return results;
}

function parseGenericRecipeLinks(html, baseUrl, sourceName) {
  const results = [];
  const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gis;

  let jm;
  while ((jm = jsonLdPattern.exec(html)) !== null) {
    try {
      const doc = JSON.parse(jm[1]);

      // Handle @graph arrays
      if (doc['@graph']) {
        for (const node of doc['@graph']) {
          const t = (node['@type'] || '').toString();
          if (t.includes('Recipe')) {
            const url = node.url || null;
            const name = node.name || null;
            if (url && name) results.push({ url, name, source: sourceName });
            if (results.length >= 5) return results;
          }
        }
        if (results.length > 0) continue;
      }

      // ItemList
      if (doc.itemListElement) {
        for (const item of doc.itemListElement) {
          const itemObj = item.item || item;
          const url = itemObj.url || null;
          const name = itemObj.name || null;
          if (url && name) results.push({ url, name, source: sourceName });
          if (results.length >= 5) return results;
        }
        if (results.length > 0) continue;
      }

      // Single Recipe
      const typeStr = (doc['@type'] || '').toString();
      if (typeStr.includes('Recipe')) {
        const url = doc.url || null;
        const name = doc.name || null;
        if (url && name) results.push({ url, name, source: sourceName });
        continue;
      }

      // Array of objects at root
      if (Array.isArray(doc)) {
        for (const el of doc) {
          const t = (el['@type'] || '').toString();
          if (t.includes('Recipe')) {
            const url = el.url || null;
            const name = el.name || null;
            if (url && name) results.push({ url, name, source: sourceName });
            if (results.length >= 5) return results;
          }
        }
      }
    } catch {}
  }

  // Fallback: parse <a> tags (WordPress pattern)
  if (results.length === 0) {
    const escapedBase = baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkPattern = new RegExp(
      '<a[^>]+href="(' + escapedBase + '/[^"]+)"[^>]*>\\s*(?:<[^>]+>)*\\s*([^<]{3,80}?)\\s*(?:</[^>]+>)*\\s*</a>',
      'gi'
    );
    const seen = new Set();
    const skipSegments = ['/category/', '/tag/', '/author/', '/page/', '#', '/feed/',
      '/recipes/', '/recipe-index', '/cooking-recipes', '/useful-tips', '/testimonial',
      '/contact', '/about', '/privacy', '/disclaimer'];
    let lm;
    while ((lm = linkPattern.exec(html)) !== null) {
      const url = lm[1];
      if (skipSegments.some(s => url.includes(s))) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      let name = decodeHTMLEntities(lm[2]).trim();
      if (name.length < 3 || name.length > 80) continue;
      if (!name.includes(' ') && name.length < 15) continue;
      if (['Read', 'Continue'].some(s => name.startsWith(s)) ||
          ['Home', 'Search', 'ABOUT', 'RECIPE INDEX', 'USEFUL TIPS', 'TESTIMONIALS'].includes(name)) continue;
      results.push({ url, name, source: sourceName });
      if (results.length >= 5) break;
    }
  }

  // Fallback 2: <h2>/<h3> with links
  if (results.length === 0) {
    const headingLinkPattern = /<h[23][^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>\s*([^<]{3,80}?)\s*<\/a>/gi;
    const seen = new Set();
    let hm;
    while ((hm = headingLinkPattern.exec(html)) !== null) {
      let url = hm[1];
      if (!url.startsWith('http')) url = baseUrl + url;
      if (!url.startsWith(baseUrl)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const name = decodeHTMLEntities(hm[2]).trim();
      if (name.length < 3) continue;
      results.push({ url, name, source: sourceName });
      if (results.length >= 5) break;
    }
  }

  return results;
}

function parseZutat(text, list) {
  const m = text.match(/^(\d+[.,/]?\d*)\s*(g|kg|ml|dl|l|EL|TL|Stück|Prise|Bund|Packung|Pack\.|Beutel|Dose|Becher|Scheibe|Scheiben|Blatt|Blätter|Zweiglein)?\s*(.+)$/i);
  if (m) {
    let mengeStr = m[1].replace(',', '.');
    if (mengeStr.includes('/')) {
      const frac = mengeStr.split('/');
      mengeStr = (parseFloat(frac[0]) / parseFloat(frac[1])).toString();
    }
    const menge = parseFloat(mengeStr) || 1;
    const einheit = m[2] || 'Stück';
    const artikel = m[3].trim().replace(/[,.]$/, '');
    list.push({ menge, einheit, artikel });
  } else {
    list.push({ menge: 1, einheit: 'Stück', artikel: text.trim() });
  }
}

module.exports = {
  allowedRecipeHosts,
  parseBettyBossi,
  parseJsonLdRecipes,
  parseChefkoch,
  parseGuteKueche,
  parseGenericRecipeLinks,
  parseZutat,
  decodeHTMLEntities,
  toTitleCase
};
