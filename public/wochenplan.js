// -- App-specific auth --
function showApp() {
    showAppBase();
    loadPlan();
    loadGerichte();
}

// -- Week --
const TAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const TAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
let currentMonday = getMonday(new Date());
let planData = [];

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatDate(d) {
    return `${d.getDate()}.${d.getMonth() + 1}.`;
}

function mondayStr() {
    return `${currentMonday.getFullYear()}-${String(currentMonday.getMonth()+1).padStart(2,'0')}-${String(currentMonday.getDate()).padStart(2,'0')}`;
}

function updateWeekLabel() {
    const end = new Date(currentMonday);
    end.setDate(end.getDate() + 6);
    const label = `${formatDate(currentMonday)} \u2013 ${formatDate(end)} ${end.getFullYear()}`;
    document.getElementById('weekLabel').textContent = label;
}

function changeWeek(dir) {
    currentMonday.setDate(currentMonday.getDate() + dir * 7);
    loadPlan();
}

function goToday() {
    currentMonday = getMonday(new Date());
    loadPlan();
}

// -- Data --
async function loadPlan() {
    updateWeekLabel();
    try {
        const res = await fetch(`/api/wochenplan?woche=${mondayStr()}`);
        if (res.status === 401) { showLogin(); return; }
        planData = await res.json();
    } catch (e) { planData = []; }
    renderPlan();
}

function getMeal(tag, mahlzeit) {
    return planData.find(p => p.tag === tag && p.mahlzeit === mahlzeit);
}

function renderRecipeItem(r) {
    const escaped = esc(r.name);
    return `<div class="rezept-item" onclick="loadDishZutaten('${esc(r.url)}','${escaped.replace(/'/g, "\\'")}')">
        <i class="bi bi-journal-text" style="color:var(--green-600)"></i>
        <span>${escaped}</span>
        <a href="${esc(r.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Originalrezept öffnen" style="color:var(--gray-400);font-size:0.85rem;padding:0.2rem;flex-shrink:0"><i class="bi bi-box-arrow-up-right"></i></a>
        <i class="bi bi-chevron-right" style="color:var(--gray-400);margin-left:0;font-size:0.75rem"></i>
    </div>`;
}

function renderGroupedRecipes(recipes) {
    const grouped = {};
    recipes.forEach(r => {
        const src = r.source || 'Rezepte';
        if (!grouped[src]) grouped[src] = [];
        grouped[src].push(r);
    });
    let html = '';
    for (const [source, items] of Object.entries(grouped)) {
        html += `<div style="margin-bottom:0.75rem">
            <div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:0.35rem;margin-top:0.5rem">${esc(source)}</div>
            ${items.map(r => renderRecipeItem(r)).join('')}
        </div>`;
    }
    return html;
}

function mealDisplay(meal, tag) {
    const dishes = parseDishes(meal);
    return dishes.map((d, i) => {
        const pParts = [];
        if (d.erwachsene > 0) pParts.push(`${d.erwachsene}E`);
        if (d.kinder > 0) pParts.push(`${d.kinder}K`);
        const pLabel = pParts.length ? `<span class="meal-persons-inline">${pParts.join('+')}</span>` : '';
        const urlParam = d.url ? `,'${esc(d.url).replace(/'/g, "\\'")}'` : (d.eigenId ? `,null,${d.eigenId}` : '');
        const recipeLink = d.url
            ? `<a href="${esc(d.url)}" target="_blank" rel="noopener" class="dish-cart-btn" onclick="event.stopPropagation()" title="Rezept öffnen"><i class="bi bi-box-arrow-up-right"></i></a>`
            : '';
        return `<span class="meal-dish">${esc(d.gericht)}${pLabel}${recipeLink}
            <button class="dish-cart-btn" onclick="event.stopPropagation();openDishSearch('${esc(d.gericht).replace(/'/g, "\\'")}',${d.erwachsene},${d.kinder},${tag}${urlParam})" title="Zutaten zur Einkaufsliste"><i class="bi bi-cart-plus"></i></button>
        </span>`;
    }).join('');
}

function renderPlan() {
    const grid = document.getElementById('planGrid');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = '';
    for (let i = 0; i < 7; i++) {
        const date = new Date(currentMonday);
        date.setDate(date.getDate() + i);
        const isToday = date.getTime() === today.getTime();
        const mittag = getMeal(i, 'mittag');
        const abend = getMeal(i, 'abend');

        html += `<div class="day-card ${isToday ? 'today' : ''}">
            <div class="day-header">
                <span>${TAGE[i]}</span>
                <span class="day-date">${formatDate(date)}</span>
            </div>
            <div class="meals">
                <div class="meal-slot" onclick="openMealInput(${i},'mittag')">
                    <span class="meal-label"><i class="bi bi-sun"></i> Mittag</span>
                    ${mittag
                        ? `<div class="meal-value">${mealDisplay(mittag, i)}</div>
                           <button class="meal-delete" onclick="event.stopPropagation();deleteMeal(${mittag.id})" title="Entfernen"><i class="bi bi-x-lg"></i></button>`
                        : '<span class="meal-empty">+ hinzuf\u00FCgen</span>'}
                </div>
                <div class="meal-slot" onclick="openMealInput(${i},'abend')">
                    <span class="meal-label"><i class="bi bi-moon"></i> Abend</span>
                    ${abend
                        ? `<div class="meal-value">${mealDisplay(abend, i)}</div>
                           <button class="meal-delete" onclick="event.stopPropagation();deleteMeal(${abend.id})" title="Entfernen"><i class="bi bi-x-lg"></i></button>`
                        : '<span class="meal-empty">+ hinzuf\u00FCgen</span>'}
                </div>
            </div>
        </div>`;
    }
    grid.innerHTML = html;
}

// -- Meal Input Modal --
let editTag = null;
let editMahlzeit = null;

function openMealInput(tag, mahlzeit) {
    editTag = tag;
    editMahlzeit = mahlzeit;
    const existing = getMeal(tag, mahlzeit);
    const label = `${TAGE[tag]} \u2013 ${mahlzeit === 'mittag' ? 'Mittagessen' : 'Abendessen'}`;

    // Create modal if not exists
    let overlay = document.getElementById('mealModalOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'mealModalOverlay';
        overlay.className = 'meal-modal-overlay';
        overlay.onclick = e => { if (e.target === overlay) closeMealInput(); };
        overlay.innerHTML = `<div class="meal-modal">
            <h3 id="mealModalTitle"></h3>
            <div style="margin-bottom:0.75rem">
                <label>Gerichte</label>
                <div id="dishList"></div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="addDishInput()" style="margin-top:0.4rem">
                    <i class="bi bi-plus"></i> Weiteres Gericht
                </button>
            </div>
            <div style="display:flex;gap:0.5rem;justify-content:flex-end">
                <button class="btn btn-secondary" onclick="closeMealInput()">Abbrechen</button>
                <button class="btn btn-primary" onclick="saveMeal()"><i class="bi bi-check-lg"></i> Speichern</button>
            </div>
        </div>`;
        document.body.appendChild(overlay);
    }

    document.getElementById('mealModalTitle').innerHTML = `<i class="bi bi-${mahlzeit === 'mittag' ? 'sun' : 'moon'}"></i> ${label}`;
    const dishes = existing ? parseDishes(existing) : [{ gericht: '', erwachsene: 2, kinder: 0 }];
    renderDishInputs(dishes);
    overlay.classList.add('active');
    setTimeout(() => { const first = document.querySelector('.dish-input'); if (first) first.focus(); }, 200);
}

function parseDishes(meal) {
    if (!meal) return [];
    try { return JSON.parse(meal.rezept); } catch (e) {}
    // Fallback: old format (plain text or newline-separated)
    return meal.rezept.split('\n').filter(Boolean).map(g => ({
        gericht: g, erwachsene: meal.erwachsene || 2, kinder: meal.kinder || 0
    }));
}

function renderDishInputs(dishes) {
    const list = document.getElementById('dishList');
    list.innerHTML = dishes.map((d, i) => dishRowHtml(d, i, dishes.length > 1)).join('');
}

function dishRowHtml(d, i, showDelete) {
    return `<div class="dish-row">
        <input type="text" class="dish-input" value="${esc(d.gericht)}" placeholder="Gericht ${i + 1}">
        <input type="hidden" class="dish-url" value="${esc(d.url || '')}">
        <input type="hidden" class="dish-eigen-id" value="${d.eigenId || ''}">
        <div class="dish-persons">
            <label class="dish-person-label"><i class="bi bi-person"></i>E</label>
            <input type="number" class="dish-erw" min="0" max="20" value="${d.erwachsene}" style="width:40px;text-align:center;padding:0.3rem">
            <label class="dish-person-label"><i class="bi bi-person"></i>K</label>
            <input type="number" class="dish-kind" min="0" max="20" value="${d.kinder}" style="width:40px;text-align:center;padding:0.3rem">
        </div>
        ${showDelete ? `<button type="button" class="btn btn-danger btn-icon btn-sm" onclick="removeDishInput(this)"><i class="bi bi-x"></i></button>` : ''}
    </div>`;
}

function addDishInput() {
    const list = document.getElementById('dishList');
    // Get defaults from last row
    const lastErw = list.querySelector('.dish-row:last-child .dish-erw');
    const lastKind = list.querySelector('.dish-row:last-child .dish-kind');
    const d = { gericht: '', erwachsene: lastErw ? parseInt(lastErw.value) : 2, kinder: lastKind ? parseInt(lastKind.value) : 0 };
    const temp = document.createElement('div');
    temp.innerHTML = dishRowHtml(d, list.children.length, true);
    const row = temp.firstElementChild;
    list.appendChild(row);
    row.querySelector('.dish-input').focus();
    // Add delete to first row if now 2
    if (list.children.length === 2 && !list.children[0].querySelector('button.btn-danger')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-danger btn-icon btn-sm';
        btn.onclick = function() { removeDishInput(this); };
        btn.innerHTML = '<i class="bi bi-x"></i>';
        list.children[0].appendChild(btn);
    }
}

function removeDishInput(btn) {
    const row = btn.parentElement;
    const list = row.parentElement;
    row.remove();
    if (list.children.length === 1) {
        const remaining = list.children[0].querySelector('button.btn-danger');
        if (remaining) remaining.remove();
    }
}

function closeMealInput() {
    const overlay = document.getElementById('mealModalOverlay');
    if (overlay) overlay.classList.remove('active');
    editTag = null;
    editMahlzeit = null;
}

async function saveMeal() {
    const rows = document.querySelectorAll('.dish-row');
    const dishes = Array.from(rows).map(r => {
        const dish = {
            gericht: r.querySelector('.dish-input').value.trim(),
            erwachsene: parseInt(r.querySelector('.dish-erw')?.value) || 0,
            kinder: parseInt(r.querySelector('.dish-kind')?.value) || 0
        };
        const url = r.querySelector('.dish-url')?.value;
        const eigenId = r.querySelector('.dish-eigen-id')?.value;
        if (url) dish.url = url;
        if (eigenId) dish.eigenId = parseInt(eigenId);
        return dish;
    }).filter(d => d.gericht);
    if (dishes.length === 0) return;
    const rezept = JSON.stringify(dishes);
    await fetch('/api/wochenplan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ woche: mondayStr(), tag: editTag, mahlzeit: editMahlzeit, rezept })
    });
    closeMealInput();
    loadPlan();
    toast('Gespeichert');
}

async function deleteMeal(id) {
    await fetch(`/api/wochenplan/${id}`, { method: 'DELETE' });
    loadPlan();
    toast('Entfernt');
}

// -- Dish → Einkaufsliste --
let dishSearchPersons = { erwachsene: 2, kinder: 0 };
let dishSearchDate = '';

async function openDishSearch(gericht, erw, kind, tag, url, eigenId) {
    dishSearchPersons = { erwachsene: erw, kinder: kind };
    const d = new Date(currentMonday);
    d.setDate(d.getDate() + tag);
    dishSearchDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    document.getElementById('dishSearchTitle').innerHTML = `<i class="bi bi-cart-plus"></i> ${esc(gericht)}`;
    const body = document.getElementById('dishSearchBody');
    document.getElementById('dishSearchOverlay').classList.add('active');

    // If we have a direct link (URL or eigenId), skip search and load directly
    if (eigenId) {
        body.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Zutaten werden geladen...</p>';
        loadEigenesGericht(eigenId);
        return;
    }
    if (url) {
        body.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Zutaten werden geladen...</p>';
        loadDishZutaten(url, gericht);
        return;
    }

    // Check for matching own recipe first
    await loadGerichte();
    const ownMatch = gerichteCache.find(g => g.name.toLowerCase() === gericht.toLowerCase());

    // Show options: own recipe match, Betty Bossi search, manual
    body.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Suche Rezept...</p>';

    // Search Betty Bossi in parallel
    let recipes = [];
    try {
        const res = await fetch(`/api/rezept/suche?q=${encodeURIComponent(gericht)}`);
        if (res.ok) recipes = await res.json();
    } catch (e) {}

    let html = '';

    // Own recipe match
    if (ownMatch) {
        html += `<div style="margin-bottom:0.75rem">
            <div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:0.35rem">Eigenes Gericht</div>
            <div class="rezept-item" onclick="loadEigenesGericht(${ownMatch.id})">
                <i class="bi bi-book" style="color:var(--green-600)"></i>
                <span>${esc(ownMatch.name)}</span>
                <i class="bi bi-chevron-right" style="color:var(--gray-400);margin-left:auto;font-size:0.75rem"></i>
            </div>
        </div>`;
    }

    // Other own recipes
    const otherOwn = gerichteCache.filter(g => !ownMatch || g.id !== ownMatch.id);
    if (otherOwn.length > 0) {
        html += `<div style="margin-bottom:0.75rem">
            <div style="font-size:0.75rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;margin-bottom:0.35rem">${ownMatch ? 'Weitere eigene Gerichte' : 'Eigene Gerichte'}</div>
            ${otherOwn.slice(0, 5).map(g => `<div class="rezept-item" onclick="loadEigenesGericht(${g.id})">
                <i class="bi bi-book" style="color:var(--green-600)"></i>
                <span>${esc(g.name)}</span>
                <i class="bi bi-chevron-right" style="color:var(--gray-400);margin-left:auto;font-size:0.75rem"></i>
            </div>`).join('')}
        </div>`;
    }

    // Online recipes grouped by source
    if (recipes.length > 0) {
        html += renderGroupedRecipes(recipes);
    }

    // Search + manual
    html += `<div style="border-top:1px solid var(--gray-200);padding-top:0.75rem">
        <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem">
            <input type="text" id="dishManualQuery" value="${esc(gericht)}" placeholder="Andere Suche...">
            <button class="btn btn-secondary" onclick="manualDishSearch()" style="white-space:nowrap"><i class="bi bi-search"></i></button>
        </div>
        <button class="btn btn-secondary" style="width:100%" onclick="showManualZutaten()">
            <i class="bi bi-pencil"></i> Zutaten manuell eingeben
        </button>
    </div>`;

    if (!html.trim() || (recipes.length === 0 && !ownMatch && otherOwn.length === 0)) {
        html = `<p style="color:var(--gray-500);font-size:0.85rem">Keine Rezepte gefunden.</p>` + html;
    }

    body.innerHTML = html;
}

async function loadEigenesGericht(id) {
    const body = document.getElementById('dishSearchBody');
    body.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Zutaten werden geladen...</p>';

    const res = await fetch(`/api/gerichte/${id}`);
    if (!res.ok) { body.innerHTML = '<p style="color:var(--red-500)">Fehler beim Laden.</p>'; return; }
    const data = await res.json();

    document.getElementById('dishSearchTitle').innerHTML = `<i class="bi bi-cart-plus"></i> ${esc(data.name)}`;

    if (data.zutaten.length === 0) {
        body.innerHTML = '<p style="color:var(--gray-500)">Keine Zutaten hinterlegt.</p>';
        return;
    }

    const pInfo = `${dishSearchPersons.erwachsene} Erwachsene${dishSearchPersons.kinder > 0 ? `, ${dishSearchPersons.kinder} Kinder` : ''}`;

    body.innerHTML = `
        <div style="font-size:0.8rem;color:var(--gray-500);margin-bottom:0.5rem">
            <i class="bi bi-people-fill"></i> ${pInfo} &mdash; ${data.zutaten.length} Zutaten
        </div>
        ${data.zutaten.map((z, i) => `<label class="zutat-item">
            <input type="checkbox" data-idx="${i}">
            <span>${z.menge} ${esc(z.einheit)} ${esc(z.artikel)}</span>
        </label>`).join('')}
        <button class="btn btn-primary" style="width:100%;margin-top:0.75rem" onclick="addDishZutaten()">
            <i class="bi bi-cart-plus"></i> Zur Einkaufsliste hinzuf\u00FCgen
        </button>`;
    body.dataset.zutaten = JSON.stringify(data.zutaten);
}

async function manualDishSearch() {
    const q = document.getElementById('dishManualQuery').value.trim();
    if (!q) return;
    const body = document.getElementById('dishSearchBody');
    body.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Suche...</p>';
    const res = await fetch(`/api/rezept/suche?q=${encodeURIComponent(q)}`);
    if (!res.ok) { body.innerHTML = '<p style="color:var(--red-500)">Suche fehlgeschlagen.</p>'; return; }
    const recipes = await res.json();
    if (recipes.length === 0) {
        body.innerHTML = '<p style="color:var(--gray-500)">Keine Rezepte gefunden.</p>';
        return;
    }
    body.innerHTML = renderGroupedRecipes(recipes);
}

async function loadDishZutaten(url, name) {
    const body = document.getElementById('dishSearchBody');
    body.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Zutaten werden geladen...</p>';
    document.getElementById('dishSearchTitle').innerHTML = `<i class="bi bi-cart-plus"></i> ${esc(name)}`;

    const res = await fetch(`/api/rezept/zutaten?url=${encodeURIComponent(url)}`);
    if (!res.ok) { body.innerHTML = '<p style="color:var(--red-500)">Fehler beim Laden.</p>'; return; }
    const zutaten = await res.json();

    if (zutaten.length === 0) {
        body.innerHTML = '<p style="color:var(--gray-500)">Keine Zutaten gefunden.</p>';
        return;
    }

    const pInfo = `${dishSearchPersons.erwachsene} Erwachsene${dishSearchPersons.kinder > 0 ? `, ${dishSearchPersons.kinder} Kinder` : ''}`;

    body.innerHTML = `
        <div style="font-size:0.8rem;color:var(--gray-500);margin-bottom:0.5rem">
            <i class="bi bi-people-fill"></i> ${pInfo} &mdash; ${zutaten.length} Zutaten
        </div>
        ${zutaten.map((z, i) => `<label class="zutat-item">
            <input type="checkbox" data-idx="${i}">
            <span>${z.menge} ${esc(z.einheit)} ${esc(z.artikel)}</span>
        </label>`).join('')}
        <button class="btn btn-primary" style="width:100%;margin-top:0.75rem" onclick="addDishZutaten()">
            <i class="bi bi-cart-plus"></i> Zur Einkaufsliste hinzuf\u00FCgen
        </button>`;
    body.dataset.zutaten = JSON.stringify(zutaten);
}

function mapEinheit(e) {
    const map = { 'g': 'g', 'kg': 'kg', 'ml': 'ml', 'dl': 'ml', 'l': 'Liter', 'EL': 'Stück', 'TL': 'Stück', 'Prise': 'Stück', 'Bund': 'Bund' };
    return map[e] || 'Stück';
}

async function addDishZutaten() {
    const body = document.getElementById('dishSearchBody');
    const zutaten = JSON.parse(body.dataset.zutaten || '[]');
    const checkboxes = body.querySelectorAll('input[type="checkbox"]');
    let added = 0;

    for (const cb of checkboxes) {
        if (!cb.checked) continue;
        const z = zutaten[parseInt(cb.dataset.idx)];
        const data = {
            artikel: z.artikel,
            menge: z.menge,
            einheit: mapEinheit(z.einheit),
            laden: '',
            datum: dishSearchDate
        };
        const res = await fetch('/api/artikel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) added++;
    }

    toast(`${added} Zutaten zur Einkaufsliste hinzugef\u00FCgt`);
    closeDishSearch();
}

function showManualZutaten() {
    const body = document.getElementById('dishSearchBody');
    body.innerHTML = `
        <div style="font-size:0.8rem;font-weight:600;color:var(--gray-500);margin-bottom:0.5rem">Zutaten manuell eingeben</div>
        <div id="manualZutatenList">
            ${manualZutatRow()}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="addManualZutat()" style="margin-top:0.4rem">
            <i class="bi bi-plus"></i> Weitere Zutat
        </button>
        <button class="btn btn-primary" style="width:100%;margin-top:0.75rem" onclick="addManualZutaten()">
            <i class="bi bi-cart-plus"></i> Zur Einkaufsliste hinzuf\u00FCgen
        </button>`;
    setTimeout(() => { const first = body.querySelector('.mz-artikel'); if (first) first.focus(); }, 100);
}

function manualZutatRow() {
    return `<div class="mz-row">
        <input type="text" class="mz-artikel" placeholder="Zutat" style="flex:2;min-width:100px">
        <input type="number" class="mz-menge" value="1" min="0.01" step="0.01" style="width:55px;text-align:center">
        <select class="mz-einheit" style="width:80px">
            <option>St\u00FCck</option><option>kg</option><option>g</option><option>Liter</option><option>ml</option>
            <option>Packung</option><option>Flasche</option><option>Dose</option><option>Bund</option>
        </select>
        <button type="button" class="btn btn-danger btn-icon btn-sm" onclick="removeManualZutat(this)"><i class="bi bi-x"></i></button>
    </div>`;
}

function addManualZutat() {
    const list = document.getElementById('manualZutatenList');
    const temp = document.createElement('div');
    temp.innerHTML = manualZutatRow();
    list.appendChild(temp.firstElementChild);
    list.lastElementChild.querySelector('.mz-artikel').focus();
}

function removeManualZutat(btn) {
    const row = btn.parentElement;
    const list = row.parentElement;
    if (list.children.length > 1) row.remove();
}

async function addManualZutaten() {
    const rows = document.querySelectorAll('.mz-row');
    let added = 0;
    for (const row of rows) {
        const artikel = row.querySelector('.mz-artikel').value.trim();
        if (!artikel) continue;
        const menge = parseFloat(row.querySelector('.mz-menge').value) || 1;
        const einheit = row.querySelector('.mz-einheit').value;
        const res = await fetch('/api/artikel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artikel, menge, einheit, laden: '', datum: dishSearchDate })
        });
        if (res.ok) added++;
    }
    if (added > 0) {
        toast(`${added} Zutat${added > 1 ? 'en' : ''} zur Einkaufsliste hinzugef\u00FCgt`);
        closeDishSearch();
    }
}

function closeDishSearch() {
    document.getElementById('dishSearchOverlay').classList.remove('active');
}

// -- Eigene Gerichte --
let gerichteCache = [];

async function loadGerichte() {
    try {
        const res = await fetch('/api/gerichte');
        if (res.ok) gerichteCache = await res.json();
    } catch (e) { gerichteCache = []; }
}

function openGerichteModal() {
    loadGerichteList();
    document.getElementById('gerichteOverlay').classList.add('active');
}

function closeGerichteModal() {
    document.getElementById('gerichteOverlay').classList.remove('active');
}

async function loadGerichteList() {
    await loadGerichte();
    const body = document.getElementById('gerichteBody');
    if (gerichteCache.length === 0) {
        body.innerHTML = `<p style="color:var(--gray-500);font-size:0.85rem">Noch keine eigenen Gerichte hinterlegt.</p>
            <button class="btn btn-primary" style="width:100%;margin-top:0.75rem" onclick="openGerichtEdit()">
                <i class="bi bi-plus-lg"></i> Neues Gericht
            </button>`;
        return;
    }
    body.innerHTML = `
        <div style="margin-bottom:0.75rem">
            ${gerichteCache.map(g => `<div class="rezept-item" style="justify-content:space-between">
                <span onclick="openGerichtEdit(${g.id})" style="flex:1;cursor:pointer">${esc(g.name)}</span>
                <div style="display:flex;gap:0.25rem">
                    <button class="dish-cart-btn" onclick="openGerichtEdit(${g.id})" title="Bearbeiten"><i class="bi bi-pencil"></i></button>
                    <button class="dish-cart-btn" onclick="deleteGericht(${g.id})" title="Löschen" style="color:var(--red-400)"><i class="bi bi-trash"></i></button>
                </div>
            </div>`).join('')}
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="openGerichtEdit()">
            <i class="bi bi-plus-lg"></i> Neues Gericht
        </button>`;
}

async function openGerichtEdit(id) {
    document.getElementById('gerichtEditId').value = id || '';
    document.getElementById('gerichtEditTitle').innerHTML = id
        ? '<i class="bi bi-book"></i> Gericht bearbeiten'
        : '<i class="bi bi-book"></i> Neues Gericht';

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

function closeGerichtEdit() {
    document.getElementById('gerichtEditOverlay').classList.remove('active');
}

function renderGerichtZutaten(zutaten) {
    document.getElementById('gerichtZutatenList').innerHTML = zutaten.map(z => gerichtZutatRow(z)).join('');
}

function gerichtZutatRow(z) {
    return `<div class="mz-row">
        <input type="text" class="gz-artikel" value="${esc(z.artikel)}" placeholder="Zutat" style="flex:2;min-width:100px">
        <input type="number" class="gz-menge" value="${z.menge}" min="0.01" step="0.01" style="width:55px;text-align:center">
        <select class="gz-einheit" style="width:80px">
            ${['Stück','kg','g','Liter','ml','Packung','Flasche','Dose','Bund'].map(e =>
                `<option${e === z.einheit ? ' selected' : ''}>${e}</option>`).join('')}
        </select>
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

function removeGerichtZutat(btn) {
    const row = btn.parentElement;
    const list = row.parentElement;
    if (list.children.length > 1) row.remove();
}

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
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/gerichte/${id}` : '/api/gerichte';

    const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, zutaten })
    });
    if (res.ok) {
        toast(id ? 'Gericht aktualisiert' : 'Gericht gespeichert');
        closeGerichtEdit();
        loadGerichteList();
        loadGerichte();
    }
}

async function deleteGericht(id) {
    if (!confirm('Gericht wirklich löschen?')) return;
    await fetch(`/api/gerichte/${id}`, { method: 'DELETE' });
    toast('Gericht gelöscht');
    loadGerichteList();
    loadGerichte();
}

// -- Keyboard --
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMealInput(); closeDishSearch(); closeGerichteModal(); closeGerichtEdit(); closeHaushalt(); }
    if (e.key === 'Enter' && document.getElementById('mealModalOverlay')?.classList.contains('active')) saveMeal();
});

// -- Init --
if (!_redirecting) checkAuth(showApp);
