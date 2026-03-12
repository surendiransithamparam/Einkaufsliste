// Tankrabatte - Aktuelle Tankgutscheine anzeigen

function showApp() {
    showAppBase();
    ladeGutscheine();
}

async function ladeGutscheine() {
    const loading = document.getElementById('tankrabatteLoading');
    const content = document.getElementById('tankrabatteContent');
    const error = document.getElementById('tankrabatteError');
    const footer = document.getElementById('tankrabatteFooter');

    loading.style.display = '';
    content.style.display = 'none';
    error.style.display = 'none';
    footer.style.display = 'none';

    try {
        const res = await fetch('/api/tankrabatte');
        if (!res.ok) throw new Error('Server-Fehler');
        const data = await res.json();

        renderAnbieter('CoopPronto', data.coopPronto || []);
        renderAnbieter('Migrol', data.migrol || []);
        renderAnbieter('Shell', data.shell || []);
        renderAnbieter('Avia', data.avia || []);

        loading.style.display = 'none';
        content.style.display = '';
        footer.style.display = '';

        const zeit = new Date().toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        document.getElementById('letzteAktualisierung').textContent = 'Zuletzt aktualisiert: ' + zeit;
    } catch (e) {
        loading.style.display = 'none';
        error.style.display = '';
        document.getElementById('tankrabatteErrorMsg').textContent = e.message || 'Fehler beim Laden.';
    }
}

function renderAnbieter(key, gutscheine) {
    const liste = document.getElementById('liste' + key);
    const badge = document.getElementById('badge' + key);
    const aktive = gutscheine.filter(g => !g.abgelaufen);

    badge.textContent = aktive.length;
    badge.className = 'anbieter-badge' + (aktive.length === 0 ? ' none' : '');

    if (gutscheine.length === 0) {
        liste.innerHTML = '<div class="gutschein-empty">Keine Gutscheine gefunden</div>';
        return;
    }

    liste.innerHTML = gutscheine.map(g => {
        const cls = g.abgelaufen ? ' style="opacity:0.5"' : '';
        const linkHtml = g.url
            ? `<div class="gutschein-link"><a href="${esc(g.url)}" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i></a></div>`
            : '';
        return `<div class="gutschein-card"${cls}>
            <div class="gutschein-rabatt">${esc(g.rabatt)}</div>
            <div class="gutschein-info">
                <div class="gutschein-titel">${esc(g.titel)}</div>
                <div class="gutschein-details">${esc(g.details || '')}</div>
            </div>
            ${linkHtml}
        </div>`;
    }).join('');
}

checkAuth(showApp);
