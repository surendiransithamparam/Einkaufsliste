let karten = [];
let deleteTargetId = null;

function showApp() {
    showAppBase();
    loadKarten();
}

async function loadKarten() {
    try {
        const res = await fetch('/api/kundenkarten');
        if (res.status === 401) { showLogin(); return; }
        karten = await res.json();
    } catch (e) {
        console.error('Kundenkarten laden fehlgeschlagen', e);
        karten = [];
    }
    renderKarten();
}

function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderKarten() {
    const grid = document.getElementById('kartenGrid');
    const empty = document.getElementById('kartenEmpty');

    if (karten.length === 0) {
        grid.innerHTML = '';
        empty.style.display = '';
        return;
    }

    empty.style.display = 'none';
    grid.innerHTML = karten.map(k => `
        <div class="tile">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
                <div style="display:flex;align-items:center;gap:0.4rem;font-weight:700;font-size:0.95rem;color:var(--gray-800)">
                    <i class="bi bi-credit-card" style="color:var(--green-600)"></i>
                    ${esc(k.name)}
                </div>
                <div style="display:flex;gap:0.25rem">
                    <button class="btn-icon" onclick="openEditKarte(${k.id})" title="Bearbeiten"><i class="bi bi-pencil"></i></button>
                    <button class="btn-icon" onclick="openDeleteConfirm(${k.id})" title="Löschen" style="color:var(--red-500)"><i class="bi bi-trash"></i></button>
                </div>
            </div>
            <div style="font-size:1.2rem;font-weight:700;letter-spacing:0.08em;color:var(--gray-700);font-family:monospace;word-break:break-all;margin-bottom:0.25rem">
                ${esc(k.kartennummer)}
            </div>
            ${k.notiz ? '<div style="font-size:0.78rem;color:var(--gray-400)">' + esc(k.notiz) + '</div>' : ''}
        </div>
    `).join('');
}

function openAddKarte() {
    document.getElementById('karteEditId').value = '';
    document.getElementById('karteName').value = '';
    document.getElementById('karteNummer').value = '';
    document.getElementById('karteNotiz').value = '';
    document.getElementById('karteError').style.display = 'none';
    document.getElementById('karteModalTitle').innerHTML = '<i class="bi bi-credit-card"></i> Neue Kundenkarte';
    document.getElementById('karteOverlay').classList.add('active');
}

function openEditKarte(id) {
    const k = karten.find(x => x.id === id);
    if (!k) return;
    document.getElementById('karteEditId').value = id;
    document.getElementById('karteName').value = k.name;
    document.getElementById('karteNummer').value = k.kartennummer;
    document.getElementById('karteNotiz').value = k.notiz || '';
    document.getElementById('karteError').style.display = 'none';
    document.getElementById('karteModalTitle').innerHTML = '<i class="bi bi-credit-card"></i> Karte bearbeiten';
    document.getElementById('karteOverlay').classList.add('active');
}

function closeKarteModal() {
    document.getElementById('karteOverlay').classList.remove('active');
}

async function saveKarte() {
    const id = document.getElementById('karteEditId').value;
    const name = document.getElementById('karteName').value.trim();
    const kartennummer = document.getElementById('karteNummer').value.trim();
    const notiz = document.getElementById('karteNotiz').value.trim();
    const errEl = document.getElementById('karteError');

    if (!name || !kartennummer) {
        errEl.textContent = 'Bitte Name und Kartennummer eingeben.';
        errEl.style.display = '';
        return;
    }

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/kundenkarten/${id}` : '/api/kundenkarten';
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kartennummer, notiz })
    });

    if (res.ok) {
        toast(id ? 'Karte aktualisiert' : 'Karte hinzugefügt');
        closeKarteModal();
        loadKarten();
    } else {
        const data = await res.json().catch(() => null);
        errEl.textContent = data?.error || 'Fehler beim Speichern.';
        errEl.style.display = '';
    }
}

function openDeleteConfirm(id) {
    deleteTargetId = id;
    document.getElementById('deleteOverlay').classList.add('active');
}

function closeDeleteConfirm() {
    document.getElementById('deleteOverlay').classList.remove('active');
    deleteTargetId = null;
}

async function confirmDelete() {
    if (!deleteTargetId) return;
    const res = await fetch(`/api/kundenkarten/${deleteTargetId}`, { method: 'DELETE' });
    if (res.ok) {
        toast('Karte gelöscht');
        loadKarten();
    } else {
        toast('Fehler beim Löschen', true);
    }
    closeDeleteConfirm();
}

// Keyboard
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeKarteModal(); closeDeleteConfirm(); }
});

if (!_redirecting) checkAuth(showApp);
