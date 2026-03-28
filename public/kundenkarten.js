let karten = [];
let deleteTargetId = null;
let html5QrScanner = null;
let logoOverrides = {};
let scannedBarcodeFormat = null;

// Maps html5-qrcode format names to JsBarcode format names
const BARCODE_FORMAT_MAP = {
    'QR_CODE': 'QR_CODE',
    'DATA_MATRIX': 'DATA_MATRIX',
    'AZTEC': 'AZTEC',
    'PDF_417': 'PDF_417',
    'EAN_13': 'EAN13',
    'EAN_8': 'EAN8',
    'CODE_128': 'CODE128',
    'CODE_39': 'CODE39',
    'ITF': 'ITF'
};

function mapScanFormatToJsBarcode(formatName) {
    return BARCODE_FORMAT_MAP[formatName] || 'CODE128';
}

function showApp() {
    showAppBase();
    loadKarten();
}

async function loadLogoOverrides() {
    try {
        const res = await fetch('/api/kundenkarten-logos');
        if (res.ok) logoOverrides = await res.json();
    } catch (e) {
        console.error('Logo overrides laden fehlgeschlagen', e);
    }
}

async function loadKarten() {
    await loadLogoOverrides();
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

// -- Store Logo --
const STORE_LOGOS = [
    { keywords: ['migros', 'cumulus', 'melectronics'], domain: 'migros.ch' },
    { keywords: ['coop', 'supercard', 'interdiscount', 'microspot'], domain: 'coop.ch' },
    { keywords: ['denner'], domain: 'denner.ch' },
    { keywords: ['lidl'], domain: 'lidl.ch' },
    { keywords: ['aldi'], domain: 'aldi.ch' },
    { keywords: ['spar'], domain: 'spar.ch' },
    { keywords: ['volg'], domain: 'volg.ch' },
    { keywords: ['otto'], domain: 'ottos.ch' },
    { keywords: ['ikea'], domain: 'ikea.ch' },
    { keywords: ['manor'], domain: 'manor.ch' },
    { keywords: ['mediamarkt', 'media markt'], domain: 'mediamarkt.ch' },
    { keywords: ['h&m', 'hm '], domain: 'hm.com' },
    { keywords: ['zalando'], domain: 'zalando.ch' },
    { keywords: ['galaxus', 'digitec'], domain: 'galaxus.ch' },
    { keywords: ['fnac'], domain: 'fnac.ch' },
    { keywords: ['ochsner'], domain: 'ochsnersport.ch' },
    { keywords: ['dosenbach'], domain: 'dosenbach.ch' },
    { keywords: ['fust'], domain: 'fust.ch' },
    { keywords: ['jumbo'], domain: 'jumbo.ch' },
    { keywords: ['obi'], domain: 'obi.ch' },
    { keywords: ['hornbach'], domain: 'hornbach.ch' },
];

function getStoreLogo(name) {
    const lower = name.toLowerCase();
    // Check DB overrides first
    if (logoOverrides[lower]) return logoOverrides[lower];
    // Fallback to favicon mapping
    for (const store of STORE_LOGOS) {
        if (store.keywords.some(kw => lower.includes(kw))) {
            return `https://www.google.com/s2/favicons?domain=${store.domain}&sz=32`;
        }
    }
    return null;
}

function storeLogoHtml(name, size) {
    const logo = getStoreLogo(name);
    if (logo) {
        return `<img src="${esc(logo)}" alt="" style="width:${size}px;height:${size}px;border-radius:4px;flex-shrink:0" onerror="this.style.display='none';this.nextElementSibling.style.display=''"><i class="bi bi-credit-card" style="color:var(--primary-600);font-size:${size > 24 ? '1.5rem' : '1.2rem'};flex-shrink:0;display:none"></i>`;
    }
    return `<i class="bi bi-credit-card" style="color:var(--primary-600);font-size:${size > 24 ? '1.5rem' : '1.2rem'};flex-shrink:0"></i>`;
}

function renderKarten() {
    const grid = document.getElementById('kartenGrid');
    const empty = document.getElementById('kartenEmpty');
    const filterCard = document.getElementById('kartenFilterCard');
    const searchTerm = (document.getElementById('kartenSearch')?.value || '').trim().toLowerCase();

    if (karten.length === 0) {
        grid.innerHTML = '';
        empty.style.display = '';
        if (filterCard) filterCard.style.display = 'none';
        return;
    }

    empty.style.display = 'none';
    if (filterCard) filterCard.style.display = '';

    let filtered = karten;
    if (searchTerm) {
        filtered = karten.filter(k =>
            k.name.toLowerCase().includes(searchTerm) ||
            k.kartennummer.toLowerCase().includes(searchTerm) ||
            (k.notiz && k.notiz.toLowerCase().includes(searchTerm))
        );
    }

    if (filtered.length === 0) {
        grid.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--gray-400)">Keine Karten gefunden.</div>';
        return;
    }

    grid.innerHTML = filtered.map(k => `
        <div class="tile" data-id="${k.id}" style="cursor:pointer;display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem" onclick="onKarteTileClick(event, ${k.id})">
            ${storeLogoHtml(k.name, 48)}
            <div style="flex:1;min-width:0">
                <span style="font-weight:700;font-size:0.95rem;color:var(--gray-800);display:block">${esc(k.name)}</span>
                ${k.notiz ? `<span style="font-size:0.75rem;color:var(--gray-400);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.notiz)}</span>` : ''}
            </div>
        </div>
    `).join('');
}

// -- Barcode Fullscreen Overlay --
function showBarcode(id) {
    const k = karten.find(x => x.id === id);
    if (!k) return;
    const overlay = document.getElementById('barcodeOverlay');
    document.getElementById('barcodeKarteLogo').innerHTML = storeLogoHtml(k.name, 40);
    document.getElementById('barcodeKarteName').textContent = k.name;
    document.getElementById('barcodeKarteNummer').textContent = k.kartennummer;
    const notizEl = document.getElementById('barcodeKarteNotiz');
    notizEl.textContent = k.notiz || '';
    notizEl.style.display = k.notiz ? '' : 'none';

    // Generate barcode or QR code in the correct format
    const svg = document.getElementById('barcodeDisplay');
    const qrCanvas = document.getElementById('qrcodeDisplay');
    const cleanNum = k.kartennummer.replace(/\s/g, '');
    const format = k.barcodeFormat || 'CODE128';

    const is2D = ['QR_CODE', 'DATA_MATRIX', 'AZTEC', 'PDF_417'].includes(format);
    if (is2D) {
        svg.style.display = 'none';
        qrCanvas.style.display = '';
        try {
            const qr = qrcode(0, 'M');
            qr.addData(cleanNum);
            qr.make();
            const moduleCount = qr.getModuleCount();
            const cellSize = Math.max(4, Math.floor(200 / moduleCount));
            const size = moduleCount * cellSize;
            qrCanvas.width = size;
            qrCanvas.height = size;
            const ctx = qrCanvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#000000';
            for (let row = 0; row < moduleCount; row++) {
                for (let col = 0; col < moduleCount; col++) {
                    if (qr.isDark(row, col)) {
                        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
                    }
                }
            }
        } catch (e) {
            qrCanvas.style.display = 'none';
        }
    } else {
        qrCanvas.style.display = 'none';
        svg.style.display = '';
        try {
            JsBarcode('#barcodeDisplay', cleanNum, {
                format: format,
                width: 2,
                height: 80,
                displayValue: false,
                margin: 0,
                background: '#ffffff'
            });
        } catch (e) {
            try {
                JsBarcode('#barcodeDisplay', cleanNum, {
                    format: 'CODE128',
                    width: 2,
                    height: 80,
                    displayValue: false,
                    margin: 0,
                    background: '#ffffff'
                });
            } catch (e2) {
                svg.style.display = 'none';
            }
        }
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
    document.getElementById('karteNummerWarning').style.display = 'none';
    delete document.getElementById('karteNummerWarning').dataset.acknowledged;
    document.getElementById('karteModalTitle').innerHTML = '<i class="bi bi-credit-card"></i> Neue Kundenkarte';
    document.getElementById('karteModalDeleteBtn').style.display = 'none';
    scannedBarcodeFormat = null;
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
    document.getElementById('karteNummerWarning').style.display = 'none';
    delete document.getElementById('karteNummerWarning').dataset.acknowledged;
    document.getElementById('karteModalTitle').innerHTML = '<i class="bi bi-credit-card"></i> Karte bearbeiten';
    scannedBarcodeFormat = k.barcodeFormat || null;
    const deleteBtn = document.getElementById('karteModalDeleteBtn');
    deleteBtn.style.display = '';
    deleteBtn.onclick = () => { closeKarteModal(); openDeleteConfirm(id); };
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
        { fps: 10, qrbox: { width: 250, height: 250 }, formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.QR_CODE
        ]},
        (decodedText, decodedResult) => {
            document.getElementById('karteNummer').value = decodedText;
            const formatName = decodedResult?.result?.format?.formatName;
            scannedBarcodeFormat = formatName ? mapScanFormatToJsBarcode(formatName) : 'CODE128';
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

    const warnEl = document.getElementById('karteNummerWarning');
    if (warnEl) { warnEl.style.display = 'none'; }

    const barcodeFormat = scannedBarcodeFormat || null;

    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/kundenkarten/${id}` : '/api/kundenkarten';
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kartennummer, notiz, barcodeFormat })
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

// -- Kartennummer Validierung --
function validateKartennummer(raw) {
    const warnings = [];
    const cleaned = raw.replace(/\s/g, '');

    if (cleaned.length > 0 && cleaned.length < 4) {
        warnings.push('Kartennummer scheint sehr kurz zu sein.');
    }

    if (cleaned.length > 0 && !/^[\d\s]+$/.test(raw)) {
        warnings.push('Kartennummer enthält ungewöhnliche Zeichen (erwartet: Ziffern und Leerzeichen).');
    }

    if (/^\d{13}$/.test(cleaned)) {
        const digits = cleaned.split('').map(Number);
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            sum += digits[i] * (i % 2 === 0 ? 1 : 3);
        }
        const checkDigit = (10 - (sum % 10)) % 10;
        if (checkDigit !== digits[12]) {
            warnings.push('EAN-13 Prüfziffer stimmt nicht (erwartet: ' + checkDigit + ').');
        }
    }

    return warnings;
}

function previewKarteValidation() {
    const val = document.getElementById('karteNummer').value.trim();
    const warnEl = document.getElementById('karteNummerWarning');
    const warnTextEl = document.getElementById('karteNummerWarningText');
    if (!val) { warnEl.style.display = 'none'; return; }
    const warnings = validateKartennummer(val);
    if (warnings.length > 0) {
        warnTextEl.textContent = warnings.join(' ');
        warnEl.style.display = '';
    } else {
        warnEl.style.display = 'none';
    }
    delete warnEl.dataset.acknowledged;
}

// -- Long-Press Handler --
let longPressTimer = null;
let longPressTriggered = false;

function onKarteTileClick(e, id) {
    if (longPressTriggered) { longPressTriggered = false; return; }
    showBarcode(id);
}

document.addEventListener('pointerdown', e => {
    const tile = e.target.closest('.tile');
    if (!tile || !tile.dataset.id) return;
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressTriggered = true;
        openEditKarte(parseInt(tile.dataset.id));
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

// Keyboard
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeBarcodeOverlay(); closeKarteModal(); closeDeleteConfirm(); }
});

if (!_redirecting) checkAuth(showApp);
