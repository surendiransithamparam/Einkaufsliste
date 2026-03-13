// Aktionen & Tankrabatte

function showApp() {
    showAppBase();
    ladeGutscheine();

    // Check for search parameter from Einkauf page badge click
    const params = new URLSearchParams(window.location.search);
    const suche = params.get('suche');
    if (suche) {
        document.getElementById('aktionenSuche').value = suche;
        searchAktionen();
    } else {
        loadAktionenOverview();
    }
}

// -- Einkaufsaktionen --

function renderAktionCard(a) {
    const preisHtml = a.preis ? `<span class="aktion-preis">CHF ${a.preis.toFixed(2)}</span>` : '';
    const origHtml = a.originalPreis ? `<span class="aktion-orig-preis">statt CHF ${a.originalPreis.toFixed(2)}</span>` : '';
    const rabattHtml = a.rabatt ? `<span class="aktion-rabatt">${esc(a.rabatt)}</span>` : '';
    const beschreibung = a.beschreibung ? `<div class="aktion-card-desc">${esc(a.beschreibung)}</div>` : '';
    const gueltig = a.gueltigVon && a.gueltigBis
        ? `<div class="aktion-card-gueltig"><i class="bi bi-calendar3"></i> ${a.gueltigVon.substring(8,10)}.${a.gueltigVon.substring(5,7)}. \u2013 ${a.gueltigBis.substring(8,10)}.${a.gueltigBis.substring(5,7)}.</div>`
        : '';
    return `<div class="aktion-card">
        <div class="aktion-card-header">
            <span class="aktion-laden"><i class="bi bi-shop"></i> ${esc(a.laden)}</span>
            ${rabattHtml}
        </div>
        <div class="aktion-card-name">${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)} <i class="bi bi-box-arrow-up-right" style="font-size:0.7rem"></i></a>` : esc(a.name)}</div>
        ${beschreibung}
        <div class="aktion-card-footer">
            <div class="aktion-card-preis">${preisHtml} ${origHtml}</div>
            <button class="aktion-add-btn" onclick="addToEinkauf('${esc(a.name).replace(/'/g, "\\'")}', '${esc(a.laden).replace(/'/g, "\\'")}', this)" title="Zum Einkauf hinzufügen">
                <i class="bi bi-cart-plus"></i>
            </button>
        </div>
        ${gueltig}
    </div>`;
}

async function loadAktionenOverview() {
    const container = document.getElementById('aktionenResults');
    const status = document.getElementById('aktionenStatus');
    try {
        const res = await fetch('/api/aktionen/alle');
        if (!res.ok) { container.innerHTML = '<p style="color:var(--red-500)">Fehler beim Laden.</p>'; return; }
        const data = await res.json();
        status.textContent = `${data.total} Aktionen geladen`;
        if (data.total === 0) {
            container.innerHTML = '<p style="color:var(--gray-500);font-size:0.85rem;text-align:center">Keine Aktionen gefunden. Die Daten werden beim ersten Aufruf geladen.</p>';
            return;
        }
        let html = '';
        for (const [laden, items] of Object.entries(data.byLaden)) {
            if (items.length === 0) continue;
            html += `<div class="store-group-header" style="margin-top:0.75rem">
                <span class="store-name"><i class="bi bi-shop"></i> ${esc(laden)}</span>
                <span class="store-count">${items.length}</span>
                <div class="store-line"></div>
            </div>`;
            html += items.slice(0, 10).map(a => renderAktionCard(a)).join('');
            if (items.length > 10) {
                html += `<p style="color:var(--gray-400);font-size:0.8rem;padding:0.25rem 0.5rem">... und ${items.length - 10} weitere</p>`;
            }
        }
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<p style="color:var(--red-500)">Fehler beim Laden der Aktionen.</p>';
    }
}

async function searchAktionen() {
    const suche = document.getElementById('aktionenSuche').value.trim();
    const laden = document.getElementById('aktionenLaden').value;
    const container = document.getElementById('aktionenResults');
    const status = document.getElementById('aktionenStatus');

    if (!suche && !laden) { loadAktionenOverview(); return; }

    container.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Suche...</p>';

    const params = new URLSearchParams();
    if (suche) params.set('suche', suche);
    if (laden) params.set('laden', laden);

    try {
        const res = await fetch(`/api/aktionen?${params}`);
        if (!res.ok) { container.innerHTML = '<p style="color:var(--red-500)">Suche fehlgeschlagen.</p>'; return; }
        const data = await res.json();
        status.textContent = `${data.length} Treffer`;
        if (data.length === 0) {
            container.innerHTML = '<p style="color:var(--gray-500);font-size:0.85rem;text-align:center">Keine Aktionen gefunden.</p>';
            return;
        }
        container.innerHTML = data.map(a => renderAktionCard(a)).join('');
    } catch (e) {
        container.innerHTML = '<p style="color:var(--red-500)">Fehler bei der Suche.</p>';
    }
}

async function refreshAktionen() {
    const status = document.getElementById('aktionenStatus');
    status.textContent = 'Aktionen werden neu geladen...';
    try {
        const res = await fetch('/api/aktionen/refresh', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            toast(`${data.total} Aktionen geladen`);
            loadAktionenOverview();
        } else {
            status.textContent = 'Fehler beim Aktualisieren.';
        }
    } catch (e) {
        status.textContent = 'Fehler beim Aktualisieren.';
    }
}

// -- Add Aktion to Einkauf --

async function addToEinkauf(name, laden, btn) {
    btn.disabled = true;
    try {
        const res = await fetch('/api/artikel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artikel: name, menge: 1, einheit: 'Stück', laden: laden, datum: '' })
        });
        if (!res.ok) throw new Error();
        btn.innerHTML = '<i class="bi bi-check-lg"></i>';
        btn.classList.add('added');
        toast(`«${name}» zum Einkauf hinzugefügt`);
    } catch (e) {
        btn.disabled = false;
        toast('Fehler beim Hinzufügen', true);
    }
}

// -- Tankrabatte --

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
