// -- App-specific auth --
let favoritenCache = [];

function showApp() {
    showAppBase();
    loadGerichte();
    loadFavoriten().then(() => { renderFavoriten(); renderEigene(); });
}

// -- Rezeptsuche --
async function searchRecipes() {
    const q = document.getElementById('rezeptSuche').value.trim();
    if (!q) return;
    const container = document.getElementById('searchResults');
    container.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem"><i class="bi bi-hourglass-split"></i> Suche auf 11 Seiten…</p>';

    const res = await fetch(`/api/rezept/suche?q=${encodeURIComponent(q)}`);
    if (!res.ok) { container.innerHTML = '<p style="color:var(--red-500)">Suche fehlgeschlagen.</p>'; return; }
    const recipes = await res.json();

    // Also filter own recipes
    const ownMatches = gerichteCache.filter(g => g.name.toLowerCase().includes(q.toLowerCase()));

    if (recipes.length === 0 && ownMatches.length === 0) {
        container.innerHTML = '<p style="color:var(--gray-500);font-size:0.85rem">Keine Rezepte gefunden.</p>';
        return;
    }

    let html = '';

    if (ownMatches.length > 0) {
        html += `<div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:0.4rem">Eigene Gerichte</div>
        <div class="recipe-grid" style="margin-bottom:1rem">
            ${ownMatches.map(g => `<div class="recipe-card" onclick="openAddToPlan('${esc(g.name).replace(/'/g,"\\'")}', null, ${g.id})">
                <i class="bi bi-book" style="color:var(--green-600);font-size:1.1rem;flex-shrink:0"></i>
                <span style="flex:1;font-size:0.85rem;font-weight:500">${esc(g.name)}</span>
                <span class="source-badge">Eigenes</span>
                ${favBtnHtml(g.name, null, null, g.id)}
                <i class="bi bi-calendar-plus" style="color:var(--gray-400);font-size:0.9rem;flex-shrink:0"></i>
            </div>`).join('')}
        </div>`;
    }

    // Group by source
    const grouped = {};
    recipes.forEach(r => {
        const src = r.source || 'Rezepte';
        if (!grouped[src]) grouped[src] = [];
        grouped[src].push(r);
    });

    for (const [source, items] of Object.entries(grouped)) {
        html += `<div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:0.4rem;margin-top:0.75rem">${esc(source)}</div>
        <div class="recipe-grid">
            ${items.map(r => `<div class="recipe-card" onclick="openAddToPlan('${esc(r.name).replace(/'/g,"\\'")}', '${esc(r.url).replace(/'/g,"\\'")}')">
                <i class="bi bi-journal-text" style="color:var(--green-600);font-size:1.1rem;flex-shrink:0"></i>
                <span style="flex:1;font-size:0.85rem;font-weight:500">${esc(r.name)}</span>
                <span class="source-badge">${esc(source)}</span>
                <a href="${esc(r.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Originalrezept öffnen" style="color:var(--gray-400);font-size:0.85rem;flex-shrink:0;padding:0.2rem"><i class="bi bi-box-arrow-up-right"></i></a>
                ${favBtnHtml(r.name, r.url, source, null)}
                <i class="bi bi-calendar-plus" style="color:var(--gray-400);font-size:0.9rem;flex-shrink:0"></i>
            </div>`).join('')}
        </div>`;
    }

    container.innerHTML = html;
}

// -- Favoriten --
async function loadFavoriten() {
    try {
        const res = await fetch('/api/favoriten');
        if (res.ok) favoritenCache = await res.json();
    } catch (e) { favoritenCache = []; }
}

function isFavorit(url, eigenGerichtId) {
    if (url) return favoritenCache.some(f => f.url === url);
    if (eigenGerichtId) return favoritenCache.some(f => f.eigenGerichtId === eigenGerichtId);
    return false;
}

function getFavoritId(url, eigenGerichtId) {
    let f;
    if (url) f = favoritenCache.find(fv => fv.url === url);
    else if (eigenGerichtId) f = favoritenCache.find(fv => fv.eigenGerichtId === eigenGerichtId);
    return f ? f.id : null;
}

async function toggleFavorit(name, url, quelle, eigenGerichtId, btn) {
    const favId = getFavoritId(url, eigenGerichtId);
    if (favId) {
        await fetch(`/api/favoriten/${favId}`, { method: 'DELETE' });
        toast('Favorit entfernt');
    } else {
        const body = { name };
        if (url) body.url = url;
        if (quelle) body.quelle = quelle;
        if (eigenGerichtId) body.eigenGerichtId = eigenGerichtId;
        await fetch('/api/favoriten', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        toast('Favorit gespeichert');
    }
    await loadFavoriten();
    renderFavoriten();
    // Update star icon in-place if button exists
    if (btn) {
        const isFav = url ? isFavorit(url, null) : isFavorit(null, eigenGerichtId);
        btn.innerHTML = `<i class="bi bi-star${isFav ? '-fill' : ''}"></i>`;
        btn.title = isFav ? 'Favorit entfernen' : 'Als Favorit speichern';
    }
}

function favBtnHtml(name, url, quelle, eigenGerichtId) {
    const isFav = isFavorit(url, eigenGerichtId);
    const nameEsc = esc(name).replace(/'/g, "\\'");
    const urlEsc = url ? `'${esc(url).replace(/'/g, "\\'")}'` : 'null';
    const quelleEsc = quelle ? `'${esc(quelle).replace(/'/g, "\\'")}'` : 'null';
    const eidParam = eigenGerichtId || 'null';
    return `<button class="dish-cart-btn fav-btn" onclick="event.stopPropagation();toggleFavorit('${nameEsc}',${urlEsc},${quelleEsc},${eidParam},this)" title="${isFav ? 'Favorit entfernen' : 'Als Favorit speichern'}" style="color:${isFav ? 'var(--yellow-500, #eab308)' : 'var(--gray-400)'};font-size:0.95rem;flex-shrink:0"><i class="bi bi-star${isFav ? '-fill' : ''}"></i></button>`;
}

function renderFavoriten() {
    const el = document.getElementById('favoritenSection');
    if (!el) return;
    if (favoritenCache.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = `<div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:0.4rem"><i class="bi bi-star-fill" style="color:var(--yellow-500, #eab308)"></i> Favoriten</div>
    <div class="recipe-grid" style="margin-bottom:1rem">
        ${favoritenCache.map(f => {
            const nameEsc = esc(f.name).replace(/'/g, "\\'");
            const urlParam = f.url ? `'${esc(f.url).replace(/'/g, "\\'")}'` : 'null';
            const eidParam = f.eigenGerichtId || 'null';
            return `<div class="recipe-card" onclick="openAddToPlan('${nameEsc}', ${urlParam}, ${eidParam})">
                ${f.eigenGerichtId ? '<i class="bi bi-book" style="color:var(--green-600);font-size:1.1rem;flex-shrink:0"></i>' : '<i class="bi bi-journal-text" style="color:var(--green-600);font-size:1.1rem;flex-shrink:0"></i>'}
                <span style="flex:1;font-size:0.85rem;font-weight:500">${esc(f.name)}</span>
                ${f.quelle ? `<span class="source-badge">${esc(f.quelle)}</span>` : ''}
                ${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Rezept öffnen" style="color:var(--gray-400);font-size:0.85rem;flex-shrink:0;padding:0.2rem"><i class="bi bi-box-arrow-up-right"></i></a>` : ''}
                ${favBtnHtml(f.name, f.url, f.quelle, f.eigenGerichtId)}
                <i class="bi bi-calendar-plus" style="color:var(--gray-400);font-size:0.9rem;flex-shrink:0"></i>
            </div>`;
        }).join('')}
    </div>`;
}

// -- Eigene Gerichte Anzeige --
let gerichteCache = [];

async function loadGerichte() {
    try {
        const res = await fetch('/api/gerichte');
        if (res.ok) gerichteCache = await res.json();
    } catch (e) { gerichteCache = []; }
}

function renderEigene() {
    loadGerichte().then(() => {
        const el = document.getElementById('eigeneSection');
        if (gerichteCache.length === 0) { el.innerHTML = ''; return; }
        el.innerHTML = `<div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:0.4rem">Eigene Gerichte</div>
        <div class="recipe-grid">
            ${gerichteCache.map(g => `<div class="recipe-card" onclick="openAddToPlan('${esc(g.name).replace(/'/g,"\\'")}', null, ${g.id})">
                <i class="bi bi-book" style="color:var(--green-600);font-size:1.1rem;flex-shrink:0"></i>
                <span style="flex:1;font-size:0.85rem;font-weight:500">${esc(g.name)}</span>
                ${favBtnHtml(g.name, null, null, g.id)}
                <i class="bi bi-calendar-plus" style="color:var(--gray-400);font-size:0.9rem;flex-shrink:0"></i>
            </div>`).join('')}
        </div>`;
    });
}

// -- Zum Wochenplan hinzufügen --
const TAGE_KURZ = ['Mo','Di','Mi','Do','Fr','Sa','So'];
let planMonday = getMonday(new Date());
let selectedDay = null;
let selectedMeal = 'mittag';
let addRecipeName = '';
let addRecipeUrl = null;
let addRecipeEigenId = null;

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0,0,0,0);
    return date;
}

function formatDate(d) { return `${d.getDate()}.${d.getMonth()+1}.`; }

function mondayStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function openAddToPlan(name, url, eigenId) {
    addRecipeName = name;
    addRecipeUrl = url || null;
    addRecipeEigenId = eigenId || null;
    document.getElementById('addToPlanRecipeName').innerHTML = `<strong>${esc(name)}</strong>`;
    planMonday = getMonday(new Date());
    selectedDay = new Date().getDay();
    selectedDay = selectedDay === 0 ? 6 : selectedDay - 1;
    selectedMeal = 'mittag';
    updatePlanWeekLabel();
    renderDayPicker();
    updateMealBtns();
    document.getElementById('addToPlanOverlay').classList.add('active');
}

function closeAddToPlan() {
    document.getElementById('addToPlanOverlay').classList.remove('active');
}

function changePlanWeek(dir) {
    planMonday.setDate(planMonday.getDate() + dir * 7);
    updatePlanWeekLabel();
    renderDayPicker();
}

function updatePlanWeekLabel() {
    const end = new Date(planMonday);
    end.setDate(end.getDate() + 6);
    document.getElementById('planWeekLabel').textContent = `${formatDate(planMonday)} – ${formatDate(end)} ${end.getFullYear()}`;
}

function renderDayPicker() {
    const picker = document.getElementById('dayPicker');
    let html = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(planMonday);
        d.setDate(d.getDate() + i);
        html += `<button class="day-pick-btn ${i === selectedDay ? 'selected' : ''}" onclick="selectDay(${i})">
            ${TAGE_KURZ[i]}
            <span class="day-date">${formatDate(d)}</span>
        </button>`;
    }
    picker.innerHTML = html;
}

function selectDay(i) { selectedDay = i; renderDayPicker(); }

function selectMeal(btn) { selectedMeal = btn.dataset.meal; updateMealBtns(); }

function updateMealBtns() {
    document.querySelectorAll('.meal-pick-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.meal === selectedMeal);
    });
}

async function confirmAddToPlan() {
    if (selectedDay === null) { toast('Bitte einen Tag wählen'); return; }
    const erw = parseInt(document.getElementById('planErw').value) || 2;
    const kind = parseInt(document.getElementById('planKind').value) || 0;

    const woche = mondayStr(planMonday);
    let existingDishes = [];
    try {
        const res = await fetch(`/api/wochenplan?woche=${woche}`);
        if (res.ok) {
            const data = await res.json();
            const existing = data.find(p => p.tag === selectedDay && p.mahlzeit === selectedMeal);
            if (existing) {
                try { existingDishes = JSON.parse(existing.rezept); } catch(e) {
                    existingDishes = existing.rezept.split('\n').filter(Boolean).map(g => ({
                        gericht: g, erwachsene: existing.erwachsene || 2, kinder: existing.kinder || 0
                    }));
                }
            }
        }
    } catch(e) {}

    const newDish = { gericht: addRecipeName, erwachsene: erw, kinder: kind };
    if (addRecipeUrl) newDish.url = addRecipeUrl;
    if (addRecipeEigenId) newDish.eigenId = addRecipeEigenId;
    existingDishes.push(newDish);
    const rezept = JSON.stringify(existingDishes);

    const res = await fetch('/api/wochenplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ woche, tag: selectedDay, mahlzeit: selectedMeal, rezept })
    });

    if (res.ok) {
        const TAGE = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
        toast(`${addRecipeName} → ${TAGE[selectedDay]} ${selectedMeal === 'mittag' ? 'Mittag' : 'Abend'}`);
        closeAddToPlan();
    } else {
        toast('Fehler beim Speichern');
    }
}

// -- Eigene Gerichte verwalten --
function openGerichteModal() { loadGerichteList(); document.getElementById('gerichteOverlay').classList.add('active'); }
function closeGerichteModal() { document.getElementById('gerichteOverlay').classList.remove('active'); }

async function loadGerichteList() {
    await loadGerichte();
    const body = document.getElementById('gerichteBody');
    if (gerichteCache.length === 0) {
        body.innerHTML = `<p style="color:var(--gray-500);font-size:0.85rem">Noch keine eigenen Gerichte.</p>
            <button class="btn btn-primary" style="width:100%;margin-top:0.75rem" onclick="openGerichtEdit()"><i class="bi bi-plus-lg"></i> Neues Gericht</button>`;
        return;
    }
    body.innerHTML = `<div style="margin-bottom:0.75rem">${gerichteCache.map(g => `<div class="rezept-item" style="justify-content:space-between">
        <span onclick="openGerichtEdit(${g.id})" style="flex:1;cursor:pointer">${esc(g.name)}</span>
        <div style="display:flex;gap:0.25rem">
            <button class="dish-cart-btn" onclick="openGerichtEdit(${g.id})" title="Bearbeiten"><i class="bi bi-pencil"></i></button>
            <button class="dish-cart-btn" onclick="deleteGericht(${g.id})" title="Löschen" style="color:var(--red-400)"><i class="bi bi-trash"></i></button>
        </div>
    </div>`).join('')}</div>
    <button class="btn btn-primary" style="width:100%" onclick="openGerichtEdit()"><i class="bi bi-plus-lg"></i> Neues Gericht</button>`;
}

async function openGerichtEdit(id) {
    document.getElementById('gerichtEditId').value = id || '';
    document.getElementById('gerichtEditTitle').innerHTML = id ? '<i class="bi bi-book"></i> Gericht bearbeiten' : '<i class="bi bi-book"></i> Neues Gericht';
    if (id) {
        const res = await fetch(`/api/gerichte/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('gerichtEditName').value = data.name;
        renderGerichtZutaten(data.zutaten.length > 0 ? data.zutaten : [{ artikel: '', menge: 1, einheit: 'Stück' }]);
    } else {
        document.getElementById('gerichtEditName').value = '';
        renderGerichtZutaten([{ artikel: '', menge: 1, einheit: 'Stück' }]);
    }
    document.getElementById('gerichtEditOverlay').classList.add('active');
    setTimeout(() => document.getElementById('gerichtEditName').focus(), 200);
}
function closeGerichtEdit() { document.getElementById('gerichtEditOverlay').classList.remove('active'); }

function renderGerichtZutaten(zutaten) { document.getElementById('gerichtZutatenList').innerHTML = zutaten.map(z => gerichtZutatRow(z)).join(''); }
function gerichtZutatRow(z) {
    return `<div class="mz-row">
        <input type="text" class="gz-artikel" value="${esc(z.artikel)}" placeholder="Zutat" style="flex:2;min-width:100px">
        <input type="number" class="gz-menge" value="${z.menge}" min="0.01" step="0.01" style="width:55px;text-align:center">
        <select class="gz-einheit" style="width:80px">${['Stück','kg','g','Liter','ml','Packung','Flasche','Dose','Bund'].map(e=>`<option${e===z.einheit?' selected':''}>${e}</option>`).join('')}</select>
        <button type="button" class="btn btn-danger btn-icon btn-sm" onclick="removeGerichtZutat(this)"><i class="bi bi-x"></i></button>
    </div>`;
}
function addGerichtZutat() {
    const list = document.getElementById('gerichtZutatenList');
    const temp = document.createElement('div');
    temp.innerHTML = gerichtZutatRow({ artikel: '', menge: 1, einheit: 'Stück' });
    list.appendChild(temp.firstElementChild);
    list.lastElementChild.querySelector('.gz-artikel').focus();
}
function removeGerichtZutat(btn) { const row = btn.parentElement; if (row.parentElement.children.length > 1) row.remove(); }

async function saveGericht() {
    const name = document.getElementById('gerichtEditName').value.trim();
    if (!name) { toast('Name ist erforderlich'); return; }
    const rows = document.querySelectorAll('#gerichtZutatenList .mz-row');
    const zutaten = Array.from(rows).map(r => ({
        artikel: r.querySelector('.gz-artikel').value.trim(),
        menge: parseFloat(r.querySelector('.gz-menge').value) || 1,
        einheit: r.querySelector('.gz-einheit').value
    })).filter(z => z.artikel);
    const id = document.getElementById('gerichtEditId').value;
    const res = await fetch(id ? `/api/gerichte/${id}` : '/api/gerichte', {
        method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, zutaten })
    });
    if (res.ok) { toast(id ? 'Aktualisiert' : 'Gespeichert'); closeGerichtEdit(); loadGerichteList(); renderEigene(); }
}

async function deleteGericht(id) {
    if (!confirm('Gericht wirklich löschen?')) return;
    await fetch(`/api/gerichte/${id}`, { method: 'DELETE' });
    toast('Gelöscht'); loadGerichteList(); renderEigene();
}

// -- Keyboard --
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeAddToPlan(); closeGerichteModal(); closeGerichtEdit(); closeHaushalt(); }
});

// -- Init --
if (!_redirecting) checkAuth(showApp);
