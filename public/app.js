// -- App-specific auth --
async function showApp() {
    showAppBase();
    await loadStores();
    loadItems();
    loadAktionenMatches();
}

// -- Data --
let items = [];
let deleteTargetId = null;

async function loadItems() {
    try {
        const res = await fetch('/api/artikel');
        if (res.status === 401) { showLogin(); return; }
        items = await res.json();
    } catch (e) {
        console.error('Laden fehlgeschlagen', e);
    }
    renderList();
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

function formatDate(d) {
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
}

function daysUntil(d) {
    if (!d) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(d + 'T00:00:00');
    return Math.round((target - today) / 86400000);
}


let STORES = [];

async function loadStores() {
    try {
        const res = await fetch('/api/laden');
        if (res.ok) STORES = (await res.json()).map(s => s.name);
    } catch (e) {}
    // Update form dropdown
    const sel = document.getElementById('laden');
    sel.innerHTML = '<option value="">\u2013 Bitte w\u00E4hlen \u2013</option>' +
        STORES.map(s => `<option>${esc(s)}</option>`).join('');
}

// -- Toggle gekauft --
let gekauftSectionOpen = false;
let reactivateTargetId = null;

async function toggleGekauft(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;

    if (!item.gekauft) {
        item.gekauft = true;
        renderList();
        try {
            const res = await fetch(`/api/artikel/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            if (!res.ok) {
                item.gekauft = false;
                renderList();
                toast('Fehler beim Speichern', true);
                return;
            }
        } catch (e) {
            item.gekauft = false;
            renderList();
            toast('Netzwerkfehler – bitte erneut versuchen', true);
            return;
        }
        toast(`\u00AB${item.artikel}\u00BB erledigt`);
    } else {
        reactivateTargetId = id;
        document.getElementById('reactivateName').textContent = `\u00AB${item.artikel}\u00BB`;
        const dateInfo = document.getElementById('reactivateDateInfo');
        if (item.datum) {
            dateInfo.innerHTML = `<i class="bi bi-calendar3"></i> Aktuelles Datum: <strong>${formatDate(item.datum)}</strong>`;
        } else {
            dateInfo.innerHTML = `<i class="bi bi-calendar3"></i> Kein Datum gesetzt`;
        }
        document.getElementById('reactivateDate').value = '';
        document.getElementById('reactivateOverlay').classList.add('active');
    }
}

function closeReactivate() {
    document.getElementById('reactivateOverlay').classList.remove('active');
    reactivateTargetId = null;
}

async function confirmReactivate(useNewDate) {
    if (reactivateTargetId === null) return;
    const item = items.find(i => i.id === reactivateTargetId);
    if (item) {
        const prevGekauft = item.gekauft;
        const prevDatum = item.datum;
        item.gekauft = false;
        if (useNewDate) {
            const newDate = document.getElementById('reactivateDate').value;
            item.datum = newDate || '';
        }
        renderList();
        try {
            const res = await fetch(`/api/artikel/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            if (!res.ok) {
                item.gekauft = prevGekauft;
                item.datum = prevDatum;
                renderList();
                toast('Fehler beim Speichern', true);
                closeReactivate();
                return;
            }
        } catch (e) {
            item.gekauft = prevGekauft;
            item.datum = prevDatum;
            renderList();
            toast('Netzwerkfehler – bitte erneut versuchen', true);
            closeReactivate();
            return;
        }
        toast(`\u00AB${item.artikel}\u00BB wieder offen`);
    }
    closeReactivate();
}

function toggleGekauftSection() {
    gekauftSectionOpen = !gekauftSectionOpen;
    document.getElementById('gekauftGrid').classList.toggle('open', gekauftSectionOpen);
    document.getElementById('gekauftArrow').classList.toggle('open', gekauftSectionOpen);
    document.getElementById('gekauftClear').style.display = gekauftSectionOpen ? '' : 'none';
}

async function clearGekauft() {
    const count = items.filter(i => i.gekauft).length;
    if (count === 0) return;
    try {
        const res = await fetch('/api/artikel/gekauft', { method: 'DELETE' });
        if (!res.ok) {
            toast('Fehler beim L\u00F6schen', true);
            return;
        }
    } catch (e) {
        toast('Netzwerkfehler \u2013 bitte erneut versuchen', true);
        return;
    }
    items = items.filter(i => !i.gekauft);
    toast(`${count} gekaufte Artikel entfernt`);
    renderList();
}


// -- Modal: Create/Edit --
function openModal(id) {
    document.getElementById('editId').value = '';
    document.getElementById('modalTitle').textContent = 'Neuer Artikel';
    document.getElementById('saveBtn').innerHTML = '<i class="bi bi-check-lg"></i> Hinzuf\u00FCgen';
    document.getElementById('artikel').value = '';
    document.getElementById('menge').value = '1';
    document.getElementById('einheit').value = 'St\u00FCck';
    document.getElementById('laden').value = '';
    document.getElementById('datum').value = '';
    if (id !== undefined) {
        const item = items.find(i => i.id === id);
        if (item) {
            document.getElementById('editId').value = id;
            document.getElementById('modalTitle').textContent = 'Artikel bearbeiten';
            document.getElementById('saveBtn').innerHTML = '<i class="bi bi-check-lg"></i> Speichern';
            document.getElementById('artikel').value = item.artikel;
            document.getElementById('menge').value = item.menge;
            document.getElementById('einheit').value = item.einheit;
            document.getElementById('laden').value = item.laden || '';
            document.getElementById('datum').value = item.datum || '';
        }
    }
    document.getElementById('modalOverlay').classList.add('active');
    setTimeout(() => document.getElementById('artikel').focus(), 200);
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('active'); }

async function saveItem(e) {
    e.preventDefault();
    const editId = document.getElementById('editId').value;
    const data = {
        artikel: document.getElementById('artikel').value.trim(),
        menge: parseFloat(document.getElementById('menge').value),
        einheit: document.getElementById('einheit').value,
        laden: document.getElementById('laden').value.trim(),
        datum: document.getElementById('datum').value,
    };

    if (editId) {
        const numId = parseInt(editId);
        const item = items.find(i => i.id === numId);
        const updated = { ...item, ...data };
        await fetch(`/api/artikel/${numId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
        });
        const idx = items.findIndex(i => i.id === numId);
        if (idx >= 0) items[idx] = updated;
        toast(`\u00AB${data.artikel}\u00BB aktualisiert`);
    } else {
        const res = await fetch('/api/artikel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        data.id = result.id;
        data.erstelltAm = result.erstelltAm;
        data.gekauft = false;
        items.push(data);
        toast(`\u00AB${data.artikel}\u00BB hinzugef\u00FCgt`);
    }
    closeModal(); renderList();
}

// -- Modal: Delete --
function openDelete(id) {
    deleteTargetId = id;
    const item = items.find(i => i.id === id);
    document.getElementById('deleteName').textContent = item ? `\u00AB${item.artikel}\u00BB` : '';
    document.getElementById('deleteOverlay').classList.add('active');
}
function closeDelete() { document.getElementById('deleteOverlay').classList.remove('active'); deleteTargetId = null; }
async function confirmDelete() {
    if (deleteTargetId !== null) {
        const item = items.find(i => i.id === deleteTargetId);
        try {
            const res = await fetch(`/api/artikel/${deleteTargetId}`, { method: 'DELETE' });
            if (!res.ok) {
                toast('Fehler beim L\u00F6schen', true);
                closeDelete();
                return;
            }
        } catch (e) {
            toast('Netzwerkfehler \u2013 bitte erneut versuchen', true);
            closeDelete();
            return;
        }
        items = items.filter(i => i.id !== deleteTargetId);
        toast(`\u00AB${item?.artikel}\u00BB gel\u00F6scht`);
        renderList();
    }
    closeDelete();
}

// -- Render --
function renderList() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const laden = document.getElementById('filterLaden').value;
    const sort = document.getElementById('sortSelect').value;

    let filtered = items.filter(i => {
        if (search && !i.artikel.toLowerCase().includes(search)) return false;
        if (laden && i.laden !== laden) return false;
        return true;
    });

    filtered.sort((a, b) => {
        switch (sort) {
            case 'datum_desc': return (b.datum || '').localeCompare(a.datum || '');
            case 'artikel_asc': return a.artikel.localeCompare(b.artikel);
            case 'laden_asc': return (a.laden || 'zzz').localeCompare(b.laden || 'zzz');
            default: return (a.datum || '9999-99-99').localeCompare(b.datum || '9999-99-99');
        }
    });

    // Laden dropdown
    const ladenSelect = document.getElementById('filterLaden');
    const curLaden = ladenSelect.value;
    const usedStores = STORES.filter(s => items.some(i => i.laden === s));
    ladenSelect.innerHTML = '<option value="">Alle L\u00E4den</option>' +
        usedStores.map(s => `<option value="${esc(s)}" ${s === curLaden ? 'selected' : ''}>${esc(s)}</option>`).join('');

    const grid = document.getElementById('tileGrid');
    const gekauftSection = document.getElementById('gekauftSection');
    const gekauftGrid = document.getElementById('gekauftGrid');

    const offene = filtered.filter(i => !i.gekauft);
    const gekaufte = filtered.filter(i => i.gekauft);

    const groupBy = true;

    // Gekauft section
    if (gekaufte.length > 0) {
        gekauftSection.style.display = '';
        document.getElementById('gekauftCount').textContent = gekaufte.length;
        gekauftGrid.innerHTML = groupBy ? renderGrouped(gekaufte) : gekaufte.map(item => renderTile(item)).join('');
        gekauftGrid.classList.toggle('open', gekauftSectionOpen);
        document.getElementById('gekauftClear').style.display = gekauftSectionOpen ? '' : 'none';
    } else {
        gekauftSection.style.display = 'none';
        gekauftGrid.innerHTML = '';
    }

    if (offene.length === 0 && gekaufte.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="bi bi-cart"></i></div>
                <div class="empty-title">${items.length === 0 ? 'Noch keine Artikel' : 'Keine Treffer'}</div>
                <div class="empty-text">${items.length === 0 ? 'F\u00FCge deinen ersten Artikel hinzu.' : 'Passe den Filter oder die Suche an.'}</div>
                ${items.length === 0 ? '<button class="btn btn-primary" onclick="openModal()"><i class="bi bi-plus-lg"></i> Neuer Artikel</button>' : ''}
            </div>`;
        document.getElementById('itemCount').textContent = '';
        return;
    }

    if (offene.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon"><i class="bi bi-check-circle" style="color:var(--green-600)"></i></div>
                <div class="empty-title">Alles erledigt!</div>
                <div class="empty-text">Alle Artikel wurden gekauft.</div>
            </div>`;
    } else if (groupBy) {
        grid.innerHTML = renderGrouped(offene);
    } else {
        grid.innerHTML = offene.map(item => renderTile(item)).join('');
    }

    const total = offene.length + gekaufte.length;
    document.getElementById('itemCount').textContent =
        `${offene.length} offen${gekaufte.length > 0 ? `, ${gekaufte.length} gekauft` : ''} \u2014 ${total} Artikel`;
}

function renderTile(item) {
        const diff = daysUntil(item.datum);
        const s = item.datum ? (diff < 0 ? 'overdue' : diff === 0 ? 'today' : 'ok') : 'ok';
        const cls = s === 'overdue' ? 'overdue' : s === 'today' ? 'today' : '';

        // Date label
        let dateLabel, dateClass;
        const dateFormatted = item.datum ? formatDate(item.datum) + ' \u00B7 ' : '';
        if (!item.datum) {
            dateLabel = 'Kein Datum';
            dateClass = '';
        } else if (s === 'overdue') {
            dateLabel = diff === -1 ? 'Gestern' : `${Math.abs(diff)} Tage \u00FCberf\u00E4llig`;
            dateClass = 'overdue';
        } else if (s === 'today') {
            dateLabel = 'Heute';
            dateClass = 'today';
        } else if (diff === 1) {
            dateLabel = 'Morgen';
            dateClass = '';
        } else {
            dateLabel = `in ${diff} Tagen`;
            dateClass = '';
        }

        // Status badge
        let badgeHtml = '';
        if (s === 'overdue') badgeHtml = `<span class="tile-badge danger"><i class="bi bi-exclamation-triangle-fill"></i> \u00DCberf\u00E4llig</span>`;
        else if (s === 'today') badgeHtml = `<span class="tile-badge warn"><i class="bi bi-clock-fill"></i> Heute</span>`;

        // Aktion badge
        const aktionBadge = renderAktionBadge(item.id);

        const isGekauft = item.gekauft;
        const tileCls = [cls, isGekauft ? 'gekauft' : '', aktionBadge ? 'has-aktion' : ''].filter(Boolean).join(' ');
        const checkIcon = isGekauft ? 'bi-check-circle-fill' : 'bi-circle';
        const doneBadge = isGekauft ? '<span class="tile-badge done"><i class="bi bi-check-lg"></i> Gekauft</span>' : badgeHtml;

        return `<div class="tile ${tileCls}" onclick="onTileClick(event,${item.id})" style="cursor:pointer">
            <div class="tile-header">
                <div style="display:flex;align-items:center;gap:0.5rem;flex:1;min-width:0">
                    <i class="bi ${checkIcon}" style="font-size:1rem;flex-shrink:0;color:${isGekauft ? 'var(--green-600)' : 'var(--gray-300)'}"></i>
                    <div class="tile-title">${esc(item.artikel)}</div>
                </div>
                <div class="tile-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-secondary btn-icon" onclick="openModal(${item.id})" title="Bearbeiten"><i class="bi bi-pencil"></i></button>
                    <button class="btn btn-danger btn-icon" onclick="openDelete(${item.id})" title="L\u00F6schen"><i class="bi bi-trash"></i></button>
                </div>
            </div>
            <div class="tile-info">
                <span class="tile-field-value large">${item.menge} ${esc(item.einheit)}</span>
                ${item.laden ? `<span class="tile-field-value"><i class="bi bi-shop"></i> ${esc(item.laden)}</span>` : ''}
            </div>
            ${aktionBadge ? `<div class="tile-aktion-row">${aktionBadge}</div>` : ''}
            <div class="tile-footer">
                <div class="tile-date ${dateClass}">
                    <i class="bi bi-calendar3"></i>
                    ${dateFormatted}${dateLabel}
                </div>
                ${doneBadge}
            </div>
        </div>`;
}

// -- Grouped rendering --
function renderGrouped(list) {
    const groups = {};
    list.forEach(item => {
        const key = item.laden || '';
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    });

    const keys = Object.keys(groups).sort((a, b) => {
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b);
    });

    let html = '';
    keys.forEach(key => {
        const storeName = key || 'Kein Laden';
        const icon = `<i class="bi ${key ? 'bi-shop' : 'bi-question-circle'}"></i>`;
        html += `<div class="store-group-header">
            <span class="store-name">${icon} ${esc(storeName)}</span>
            <span class="store-count">${groups[key].length}</span>
            <div class="store-line"></div>
        </div>`;
        html += groups[key].sort((a, b) => a.artikel.localeCompare(b.artikel)).map(item => renderTile(item)).join('');
    });
    return html;
}

// -- Rezept --
function openRezept() {
    document.getElementById('rezeptQuery').value = '';
    document.getElementById('rezeptResults').innerHTML = '';
    document.getElementById('rezeptZutaten').innerHTML = '';
    document.getElementById('rezeptOverlay').classList.add('active');
    setTimeout(() => document.getElementById('rezeptQuery').focus(), 200);
}

function closeRezept() { document.getElementById('rezeptOverlay').classList.remove('active'); }

async function searchRezept() {
    const q = document.getElementById('rezeptQuery').value.trim();
    if (!q) return;
    const results = document.getElementById('rezeptResults');
    results.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Suche...</p>';
    document.getElementById('rezeptZutaten').innerHTML = '';

    const res = await fetch(`/api/rezept/suche?q=${encodeURIComponent(q)}`);
    if (!res.ok) { results.innerHTML = '<p style="color:var(--red-500)">Suche fehlgeschlagen.</p>'; return; }
    const data = await res.json();

    if (data.length === 0) {
        results.innerHTML = '<p style="color:var(--gray-500);font-size:0.85rem">Keine Rezepte gefunden.</p>';
        return;
    }

    results.innerHTML = '<div style="font-size:0.8rem;font-weight:600;color:var(--gray-500);margin-bottom:0.4rem">Rezepte</div>' +
        data.map(r => `<div class="rezept-item" onclick="loadZutaten('${esc(r.url)}','${esc(r.name)}')">
            <i class="bi bi-journal-text" style="color:var(--green-600)"></i>
            <span>${esc(r.name)}</span>
            <i class="bi bi-chevron-right" style="color:var(--gray-400);margin-left:auto;font-size:0.75rem"></i>
        </div>`).join('');
}

async function loadZutaten(url, name) {
    const container = document.getElementById('rezeptZutaten');
    container.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Zutaten werden geladen...</p>';
    document.getElementById('rezeptResults').innerHTML = `<div style="font-size:0.85rem;color:var(--gray-500);margin-bottom:0.5rem">
        <i class="bi bi-journal-text" style="color:var(--green-600)"></i> <strong>${esc(name)}</strong>
    </div>`;

    const res = await fetch(`/api/rezept/zutaten?url=${encodeURIComponent(url)}`);
    if (!res.ok) { container.innerHTML = '<p style="color:var(--red-500)">Fehler beim Laden.</p>'; return; }
    const zutaten = await res.json();

    if (zutaten.length === 0) {
        container.innerHTML = '<p style="color:var(--gray-500);font-size:0.85rem">Keine Zutaten gefunden.</p>';
        return;
    }

    container.innerHTML = `
        <div style="font-size:0.8rem;font-weight:600;color:var(--gray-500);margin-bottom:0.4rem">Zutaten (${zutaten.length})</div>
        ${zutaten.map((z, i) => `<label class="zutat-item">
            <input type="checkbox" data-idx="${i}">
            <span>${z.menge} ${esc(z.einheit)} ${esc(z.artikel)}</span>
        </label>`).join('')}
        <button class="btn btn-primary" style="width:100%;margin-top:0.75rem" onclick="addZutaten()">
            <i class="bi bi-cart-plus"></i> Zur Einkaufsliste hinzuf\u00FCgen
        </button>`;
    container.dataset.zutaten = JSON.stringify(zutaten);
}

async function addZutaten() {
    const container = document.getElementById('rezeptZutaten');
    const zutaten = JSON.parse(container.dataset.zutaten || '[]');
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    let added = 0;

    for (const cb of checkboxes) {
        if (!cb.checked) continue;
        const z = zutaten[parseInt(cb.dataset.idx)];
        const data = {
            artikel: z.artikel,
            menge: z.menge,
            einheit: mapEinheit(z.einheit),
            laden: '',
            datum: ''
        };
        const res = await fetch('/api/artikel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            const result = await res.json();
            data.id = result.id;
            data.erstelltAm = result.erstelltAm;
            data.gekauft = false;
            items.push(data);
            added++;
        }
    }

    toast(`${added} Zutaten hinzugef\u00FCgt`);
    closeRezept();
    renderList();
}

function mapEinheit(e) {
    const map = { 'g': 'g', 'kg': 'kg', 'ml': 'ml', 'dl': 'ml', 'l': 'Liter', 'EL': 'Stück', 'TL': 'Stück', 'Prise': 'Stück', 'Bund': 'Bund' };
    return map[e] || 'Stück';
}

// -- Aktionen --
let aktionenMatches = {}; // { artikelId: [{name, preis, laden, ...}] }

async function loadAktionenMatches() {
    try {
        const res = await fetch('/api/aktionen/match');
        if (res.ok) {
            aktionenMatches = await res.json();
            renderList();
        }
    } catch (e) {
        console.error('Aktionen-Match fehlgeschlagen', e);
    }
}

function renderAktionBadge(itemId) {
    const matches = aktionenMatches[itemId];
    if (!matches || matches.length === 0) return '';
    const first = matches[0];
    const preisText = first.preis ? `CHF ${first.preis.toFixed(2)}` : '';
    const ladenText = first.laden || '';
    const countExtra = matches.length > 1 ? ` +${matches.length - 1}` : '';
    return `<span class="tile-badge aktion" onclick="event.stopPropagation();showAktionDetail(${itemId})" title="Aktion gefunden!">
        <i class="bi bi-tag-fill"></i> ${esc(ladenText)}${preisText ? ' ' + preisText : ''}${countExtra}
    </span>`;
}

function showAktionDetail(itemId) {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    window.location.href = `tankrabatte.html?suche=${encodeURIComponent(item.artikel)}`;
}

// -- Haushalt: logic is in shared.js --

// -- Tile click (skip if long-press) --
let longPressTriggered = false;

function onTileClick(e, id) {
    if (longPressTriggered) { longPressTriggered = false; return; }
    if (activeTileActions) { hideAllTileActions(); return; }
    toggleGekauft(id);
}

// -- Long-press for tile actions --
let longPressTimer = null;
let activeTileActions = null;

function showTileActions(tileEl) {
    hideAllTileActions();
    const actions = tileEl.querySelector('.tile-actions');
    if (actions) {
        actions.classList.add('visible');
        activeTileActions = actions;
    }
}

function hideAllTileActions() {
    if (activeTileActions) {
        activeTileActions.classList.remove('visible');
        activeTileActions = null;
    }
}

document.addEventListener('pointerdown', e => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    // Ignore if tapping on already-visible actions
    if (e.target.closest('.tile-actions')) return;
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressTriggered = true;
        showTileActions(tile);
    }, 500);
});

document.addEventListener('pointerup', () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});

document.addEventListener('pointermove', e => {
    if (longPressTimer && (Math.abs(e.movementX) > 5 || Math.abs(e.movementY) > 5)) {
        clearTimeout(longPressTimer); longPressTimer = null;
    }
});

document.addEventListener('pointercancel', () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});

// Hide actions when tapping elsewhere
document.addEventListener('pointerdown', e => {
    if (activeTileActions && !e.target.closest('.tile-actions')) {
        hideAllTileActions();
    }
}, true);

// -- Keyboard --
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeDelete(); closeReactivate(); closeHaushalt(); closeRezept(); hideAllTileActions(); }
});

// -- PWA: Service Worker --
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('SW registered', reg.scope))
        .catch(err => console.log('SW failed', err));
}

// -- PWA: Install Prompt --
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (!localStorage.getItem('installDismissed')) {
        document.getElementById('installBanner').classList.add('visible');
    }
});

function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(result => {
            if (result.outcome === 'accepted') toast('App wird installiert!');
            deferredPrompt = null;
            document.getElementById('installBanner').classList.remove('visible');
        });
    }
}

function dismissInstall() {
    document.getElementById('installBanner').classList.remove('visible');
    localStorage.setItem('installDismissed', '1');
}

// -- Offline detection --
function updateOnlineStatus() {
    document.getElementById('offlineBar').classList.toggle('visible', !navigator.onLine);
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();


// -- Init --
_onLogout = () => { items = []; };
checkAuth(showApp);
