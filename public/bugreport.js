// -- Bug Report (shared across all pages) --

function ensureBugReportModal() {
    if (document.getElementById('bugReportOverlay')) return;
    const div = document.createElement('div');
    div.innerHTML = `<div class="modal-overlay" id="bugReportOverlay" onclick="if(event.target===this)closeBugReport()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;justify-content:center;align-items:flex-end;padding:0">
    <div style="background:var(--surface);border-radius:var(--radius) var(--radius) 0 0;width:100%;max-width:500px;margin:0 auto;max-height:90dvh;overflow-y:auto;padding:1.25rem;animation:slideUp .25s ease">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h2 style="font-size:1.1rem;margin:0;display:flex;align-items:center;gap:0.5rem;color:var(--gray-800)"><i class="bi bi-bug" style="color:var(--green-600)"></i> Bug melden</h2>
            <button onclick="closeBugReport()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--gray-400);padding:0.25rem"><i class="bi bi-x-lg"></i></button>
        </div>
        <p style="font-size:0.82rem;color:var(--gray-500);margin-bottom:1rem">Deine Meldung wird anonym als GitHub Issue erstellt.</p>
        <form onsubmit="submitBugReport(event)">
            <label for="bugTitel" style="font-size:0.82rem;font-weight:600;color:var(--gray-700);display:block;margin-bottom:0.25rem">Titel *</label>
            <input type="text" id="bugTitel" maxlength="100" required placeholder="Kurze Beschreibung des Problems" style="width:100%;padding:0.6rem;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:0.88rem;margin-bottom:0.75rem;box-sizing:border-box">
            <label for="bugBeschreibung" style="font-size:0.82rem;font-weight:600;color:var(--gray-700);display:block;margin-bottom:0.25rem">Beschreibung *</label>
            <textarea id="bugBeschreibung" maxlength="2000" rows="4" required placeholder="Was ist passiert? Was hast du erwartet?" style="width:100%;padding:0.6rem;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:0.88rem;margin-bottom:0.75rem;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>
            <label for="bugSchritte" style="font-size:0.82rem;font-weight:600;color:var(--gray-700);display:block;margin-bottom:0.25rem">Schritte zum Reproduzieren</label>
            <textarea id="bugSchritte" rows="3" placeholder="1. Gehe zu ...&#10;2. Klicke auf ...&#10;3. ..." style="width:100%;padding:0.6rem;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:0.88rem;margin-bottom:0.75rem;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>
            <label for="bugKontakt" style="font-size:0.82rem;font-weight:600;color:var(--gray-700);display:block;margin-bottom:0.25rem">Kontakt (optional)</label>
            <input type="email" id="bugKontakt" placeholder="E-Mail für Rückfragen" style="width:100%;padding:0.6rem;border:1px solid var(--gray-200);border-radius:var(--radius-sm);font-size:0.88rem;margin-bottom:0.75rem;box-sizing:border-box">
            <div id="bugError" style="display:none;color:var(--red-500);font-size:0.8rem;font-weight:500;margin-bottom:0.5rem"></div>
            <button type="submit" id="bugSubmitBtn" style="width:100%;padding:0.7rem;background:var(--green-600);color:#fff;border:none;border-radius:var(--radius-sm);font-size:0.9rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:0.4rem">
                <i class="bi bi-send"></i> Absenden
            </button>
        </form>
    </div>
</div>`;
    document.body.appendChild(div.firstElementChild);
    if (!document.getElementById('bugReportStyles')) {
        const style = document.createElement('style');
        style.id = 'bugReportStyles';
        style.textContent = '@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }';
        document.head.appendChild(style);
    }
}

function openBugReport() {
    ensureBugReportModal();
    document.getElementById('bugTitel').value = '';
    document.getElementById('bugBeschreibung').value = '';
    document.getElementById('bugSchritte').value = '';
    document.getElementById('bugKontakt').value = '';
    document.getElementById('bugError').style.display = 'none';
    document.getElementById('bugSubmitBtn').disabled = false;
    document.getElementById('bugSubmitBtn').innerHTML = '<i class="bi bi-send"></i> Absenden';
    document.getElementById('bugReportOverlay').style.display = 'flex';
    setTimeout(() => document.getElementById('bugTitel').focus(), 200);
}

function closeBugReport() {
    const overlay = document.getElementById('bugReportOverlay');
    if (overlay) overlay.style.display = 'none';
}

async function submitBugReport(e) {
    e.preventDefault();
    const btn = document.getElementById('bugSubmitBtn');
    const errEl = document.getElementById('bugError');
    errEl.style.display = 'none';
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Wird gesendet...';
    try {
        const res = await fetch('/api/bugreport', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titel: document.getElementById('bugTitel').value.trim(),
                beschreibung: document.getElementById('bugBeschreibung').value.trim(),
                schritte: document.getElementById('bugSchritte').value.trim(),
                kontakt: document.getElementById('bugKontakt').value.trim()
            })
        });
        const data = await res.json();
        if (res.ok) {
            closeBugReport();
            toast('Bug-Report gesendet. Danke!');
        } else {
            errEl.textContent = data.error || 'Fehler beim Senden.';
            errEl.style.display = '';
        }
    } catch {
        errEl.textContent = 'Netzwerkfehler. Bitte versuche es erneut.';
        errEl.style.display = '';
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-send"></i> Absenden';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBugReport(); });
