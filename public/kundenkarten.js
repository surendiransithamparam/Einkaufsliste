let karten = [];
let deleteTargetId = null;
let html5QrScanner = null;

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
        <div class="tile" style="cursor:pointer;display:flex;align-items:center;gap:0.6rem;padding:0.75rem 1rem" onclick="showBarcode(${k.id})">
            <i class="bi bi-credit-card" style="color:var(--green-600);font-size:1.2rem;flex-shrink:0"></i>
            <span style="font-weight:700;font-size:0.95rem;color:var(--gray-800);flex:1">${esc(k.name)}</span>
            <div style="display:flex;gap:0.25rem;flex-shrink:0" onclick="event.stopPropagation()">
                <button class="btn-icon" onclick="openEditKarte(${k.id})" title="Bearbeiten"><i class="bi bi-pencil"></i></button>
                <button class="btn-icon" onclick="openDeleteConfirm(${k.id})" title="Löschen" style="color:var(--red-500)"><i class="bi bi-trash"></i></button>
            </div>
        </div>
    `).join('');
}

// -- Barcode Fullscreen Overlay --
function showBarcode(id) {
    const k = karten.find(x => x.id === id);
    if (!k) return;
    const overlay = document.getElementById('barcodeOverlay');
    document.getElementById('barcodeKarteName').textContent = k.name;
    document.getElementById('barcodeKarteNummer').textContent = k.kartennummer;
    const notizEl = document.getElementById('barcodeKarteNotiz');
    notizEl.textContent = k.notiz || '';
    notizEl.style.display = k.notiz ? '' : 'none';

    // Generate barcode
    const svg = document.getElementById('barcodeDisplay');
    svg.style.display = '';
    try {
        const cleanNum = k.kartennummer.replace(/\s/g, '');
        JsBarcode('#barcodeDisplay', cleanNum, {
            format: 'CODE128',
            width: 2,
            height: 80,
            displayValue: false,
            margin: 0,
            background: '#ffffff'
        });
    } catch (e) {
        svg.style.display = 'none';
    }

    overlay.classList.add('active');
}

function closeBarcodeOverlay() {
    document.getElementById('barcodeOverlay').classList.remove('active');
}

function openAddKarte() {
    document.getElementById('karteEditId').value = '';
    document.getElementById('karteName').value = '';
    document.getElementById('karteNummer').value = '';
    document.getElementById('karteNotiz').value = '';
    document.getElementById('karteError').style.display = 'none';
    document.getElementById('karteModalTitle').innerHTML = '<i class="bi bi-credit-card"></i> Neue Kundenkarte';
    document.getElementById('karteOverlay').classList.add('active');
    stopScan();
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
    stopScan();
}

function closeKarteModal() {
    stopScan();
    document.getElementById('karteOverlay').classList.remove('active');
}

// -- Barcode Scanner --
function startScan() {
    const container = document.getElementById('scannerContainer');
    container.style.display = '';

    if (html5QrScanner) {
        html5QrScanner.clear();
        html5QrScanner = null;
    }

    html5QrScanner = new Html5Qrcode('scannerView');
    html5QrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 100 }, formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.QR_CODE
        ]},
        (decodedText) => {
            document.getElementById('karteNummer').value = decodedText;
            toast('Barcode erkannt: ' + decodedText);
            stopScan();
        },
        () => {}
    ).catch(err => {
        console.error('Scanner Fehler:', err);
        container.style.display = 'none';
        toast('Kamera konnte nicht gestartet werden', true);
    });
}

function stopScan() {
    const container = document.getElementById('scannerContainer');
    if (container) container.style.display = 'none';
    if (html5QrScanner) {
        html5QrScanner.stop().catch(() => {});
        html5QrScanner.clear();
        html5QrScanner = null;
    }
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
    if (e.key === 'Escape') { closeBarcodeOverlay(); closeKarteModal(); closeDeleteConfirm(); }
});

if (!_redirecting) checkAuth(showApp);
