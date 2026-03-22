const https = require('https');

async function scrapePreispirat(anbieter) {
  const url = `https://www.preispirat.ch/gutscheine/${anbieter}/`;
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } }, (resp) => {
      let html = '';
      resp.on('data', chunk => html += chunk);
      resp.on('end', () => {
        const gutscheine = [];
        const blocks = html.split('deal_block_row');
        for (let i = 1; i < blocks.length; i++) {
          const block = blocks[i];
          const titelMatch = block.match(/<a[^>]*href="(https:\/\/www\.preispirat\.ch\/[^"]*)"[^>]*>([^<]+)<\/a>/);
          const rabattMatch = block.match(/<h5[^>]*>([^<]+)<\/h5>/);
          const abgelaufen = block.includes('expired_coupon') || block.includes('Abgelaufen');
          if (titelMatch) {
            gutscheine.push({
              titel: (titelMatch[2] || '').trim(),
              url: (titelMatch[1] || '').trim(),
              rabatt: rabattMatch ? rabattMatch[1].trim() : 'Rabatt',
              abgelaufen,
              details: abgelaufen ? 'Abgelaufen' : 'Aktiv'
            });
          }
        }
        resolve(gutscheine);
      });
      resp.on('error', () => resolve([]));
    }).on('error', () => resolve([]));
  });
}

async function scrapeShellCh() {
  const url = 'https://www.shell.ch/de_ch/shoppen-und-geniessen/aktuelle-angebote.html';
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } }, (resp) => {
      let html = '';
      resp.on('data', chunk => html += chunk);
      resp.on('end', () => {
        const gutscheine = [];
        const promoRegex = /<h[23][^>]*>([^<]*(?:rabatt|rappen|cent|sparen|tanken)[^<]*)<\/h[23]>/gi;
        let m;
        while ((m = promoRegex.exec(html)) !== null) {
          gutscheine.push({
            titel: m[1].trim(),
            url,
            rabatt: 'Aktion',
            abgelaufen: false,
            details: 'shell.ch'
          });
        }
        resolve(gutscheine);
      });
      resp.on('error', () => resolve([]));
    }).on('error', () => resolve([]));
  });
}

module.exports = {
  scrapePreispirat,
  scrapeShellCh
};
