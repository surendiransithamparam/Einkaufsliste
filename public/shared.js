// -- Shared utilities across all pages --

// Letzte besuchte Seite merken und Redirect (nur beim App-Start, nicht bei normaler Navigation)
let _redirecting = false;
(function() {
    const page = location.pathname.split('/').pop() || 'index.html';
    const trackablePages = ['index.html', 'wochenplan.html', 'rezepte.html', 'tankrabatte.html', 'kundenkarten.html'];
    if (trackablePages.includes(page)) {
        // Nur redirecten wenn kein Referrer (= App-Start/Direktaufruf, nicht Klick von anderer Seite)
        const isAppStart = !document.referrer || !document.referrer.includes(location.host);
        const lastPage = localStorage.getItem('lastVisitedPage');
        if (isAppStart && lastPage && lastPage !== page && trackablePages.includes(lastPage)) {
            _redirecting = true;
            location.replace(lastPage);
            return;
        }
        localStorage.setItem('lastVisitedPage', page);
    }
})();

let currentUser = null;

function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// -- Auth --
async function checkAuth(onSuccess) {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) { currentUser = await res.json(); onSuccess(); return; }
    } catch (e) {}
    showLogin();
}

function showLogin() {
    document.getElementById('loginScreen').classList.add('visible');
    document.getElementById('appContent').classList.add('hidden');
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('hidden');
    if (typeof WebAuthnClient !== 'undefined') initWebauthnLogin();
}

function showAppBase() {
    document.getElementById('loginScreen').classList.remove('visible');
    document.getElementById('appContent').classList.remove('hidden');
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('hidden');
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.style.display = '';
    // Show admin link in sidebar for admins
    if (currentUser && currentUser.isAdmin) {
        const nav = document.querySelector('.sidebar-nav');
        if (nav && !document.getElementById('adminSidebarLink')) {
            const link = document.createElement('a');
            link.id = 'adminSidebarLink';
            link.href = 'admin.html';
            link.className = 'sidebar-link';
            link.innerHTML = '<i class="bi bi-shield-lock"></i> <span>Admin</span>';
            nav.appendChild(link);
        }
    }
}

async function submitAuth(e) {
    e.preventDefault();
    const user = document.getElementById('authUser').value.trim();
    const pass = document.getElementById('authPass').value;
    const errEl = document.getElementById('authError');
    const successEl = document.getElementById('authSuccess');
    errEl.style.display = 'none';
    if (successEl) successEl.style.display = 'none';
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ benutzername: user, passwort: pass })
        });
        if (res.ok) { currentUser = await res.json(); showApp(); if (typeof WebAuthnClient !== 'undefined') webauthnNachLoginPruefen(); }
        else if (res.status === 403) {
            const data = await res.json().catch(() => null);
            errEl.innerHTML = esc(data?.error || 'Konto nicht aktiviert.') +
                ` <a href="#" onclick="resendActivation('${esc(user).replace(/'/g, "&#39;")}');return false" style="color:var(--green-600);text-decoration:underline">Aktivierungsmail erneut senden</a>`;
            errEl.style.display = '';
        }
        else { errEl.innerHTML = 'Benutzername oder Passwort falsch. <a href="reset.html" style="color:var(--green-600);text-decoration:underline">Passwort vergessen?</a>'; errEl.style.display = ''; }
    } catch (err) {
        errEl.textContent = 'Netzwerkfehler \u2013 bitte Verbindung pr\u00FCfen und erneut versuchen.';
        errEl.style.display = '';
    }
}

async function resendActivation(username) {
    const errEl = document.getElementById('authError');
    const successEl = document.getElementById('authSuccess');
    errEl.style.display = 'none';
    const res = await fetch('/api/auth/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benutzername: username })
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
        successEl.textContent = data?.message || 'Aktivierungsmail gesendet.';
        successEl.style.display = '';
    } else {
        errEl.textContent = data?.error || 'Fehler beim Senden.';
        errEl.style.display = '';
    }
}

let _onLogout = null;
async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    if (_onLogout) _onLogout();
    showLogin();
}

// -- Toast --
function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = isError ? 'toast error' : 'toast success';
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

// -- Profil --
function resetProfilPwPolicy() {
    ['ppol-len','ppol-upper','ppol-lower','ppol-special'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.color = ''; el.querySelector('i').className = 'bi bi-x-circle'; }
    });
    const matchEl = document.getElementById('ppol-match');
    if (matchEl) matchEl.style.display = 'none';
}

function checkProfilPwPolicy() {
    const pass = document.getElementById('profilNewPass').value;
    const conf = document.getElementById('profilNewPassConfirm').value;
    const rules = [
        { id: 'ppol-len', ok: pass.length >= 8 },
        { id: 'ppol-upper', ok: /[A-Z]/.test(pass) },
        { id: 'ppol-lower', ok: /[a-z]/.test(pass) },
        { id: 'ppol-special', ok: /[^A-Za-z0-9]/.test(pass) },
    ];
    rules.forEach(r => {
        const el = document.getElementById(r.id);
        if (el) {
            el.style.color = r.ok ? 'var(--green-600)' : 'var(--red-500)';
            el.querySelector('i').className = r.ok ? 'bi bi-check-circle-fill' : 'bi bi-x-circle';
        }
    });
    const matchEl = document.getElementById('ppol-match');
    if (matchEl) {
        if (conf.length > 0) {
            matchEl.style.display = '';
            const ok = pass === conf && pass.length > 0;
            matchEl.style.color = ok ? 'var(--green-600)' : 'var(--red-500)';
            matchEl.querySelector('i').className = ok ? 'bi bi-check-circle-fill' : 'bi bi-x-circle';
        } else {
            matchEl.style.display = 'none';
        }
    }
    return rules.every(r => r.ok) && pass === conf;
}

async function changePassword() {
    const oldPass = document.getElementById('profilOldPass').value;
    const newPass = document.getElementById('profilNewPass').value;
    const errEl = document.getElementById('profilPwError');
    const successEl = document.getElementById('profilPwSuccess');
    errEl.style.display = 'none';
    successEl.style.display = 'none';

    if (!oldPass) { errEl.textContent = 'Bitte aktuelles Passwort eingeben.'; errEl.style.display = ''; return; }
    if (!checkProfilPwPolicy()) { errEl.textContent = 'Bitte alle Passwort-Anforderungen erfüllen.'; errEl.style.display = ''; return; }

    const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ altesPasswort: oldPass, neuesPasswort: newPass })
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
        successEl.textContent = 'Passwort erfolgreich geändert.';
        successEl.style.display = '';
        document.getElementById('profilOldPass').value = '';
        document.getElementById('profilNewPass').value = '';
        document.getElementById('profilNewPassConfirm').value = '';
        resetProfilPwPolicy();
    } else {
        errEl.textContent = data?.error || 'Fehler beim Ändern des Passworts.';
        errEl.style.display = '';
    }
}

async function saveProfil() {
    const email = document.getElementById('profilEmail').value.trim();
    const res = await fetch('/api/auth/profil', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    if (res.ok) {
        currentUser.email = email;
        toast('Profil gespeichert');
    }
}

// -- Haushalt --
function ensureHaushaltModal() {
    if (document.getElementById('haushaltOverlay')) return;
    const div = document.createElement('div');
    div.innerHTML = `<div class="modal-overlay" id="haushaltOverlay" onclick="if(event.target===this)closeHaushalt()">
        <div class="modal" style="max-width:420px">
            <div class="modal-header">
                <h2><i class="bi bi-people"></i> Haushalt</h2>
                <button class="modal-close" onclick="closeHaushalt()"><i class="bi bi-x-lg"></i></button>
            </div>
            <div class="modal-body" id="haushaltBody"></div>
        </div>
    </div>`;
    document.body.appendChild(div.firstElementChild);
}

async function openHaushalt() {
    ensureHaushaltModal();
    const body = document.getElementById('haushaltBody');
    body.innerHTML = '<p style="color:var(--gray-400);text-align:center">Laden...</p>';
    document.getElementById('haushaltOverlay').classList.add('active');

    const meRes = await fetch('/api/auth/me');
    if (meRes.ok) currentUser = await meRes.json();

    if (currentUser.haushalt) {
        const membersRes = await fetch('/api/haushalt/mitglieder');
        const members = membersRes.ok ? await membersRes.json() : [];
        const isErsteller = currentUser.haushalt.isErsteller;
        body.innerHTML = `
            <div style="margin-bottom:1rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.25rem">
                    <span style="font-weight:700;font-size:1rem">${esc(currentUser.haushalt.name)}</span>
                    ${isErsteller ? '<button class="btn-icon" onclick="renameHaushalt()" title="Umbenennen" style="font-size:0.85rem;color:var(--gray-400)"><i class="bi bi-pencil"></i></button>' : ''}
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
                    <span style="font-size:0.8rem;color:var(--gray-500)">Einladungscode:</span>
                    <code style="background:var(--gray-100);padding:0.25rem 0.6rem;border-radius:6px;font-weight:700;font-size:1rem;letter-spacing:0.1em">${esc(currentUser.haushalt.code)}</code>
                    <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${currentUser.haushalt.code}');toast('Code kopiert')" title="Kopieren">
                        <i class="bi bi-clipboard"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="shareHaushaltCode()" title="Teilen">
                        <i class="bi bi-share"></i>
                    </button>
                </div>
            </div>
            <div style="margin-bottom:1rem">
                <div style="font-size:0.8rem;font-weight:600;color:var(--gray-500);margin-bottom:0.4rem">Mitglieder</div>
                ${members.map(m => {
                    const rolleLabel = m.isErsteller ? 'Admin' : m.rolle === 'schreibend' ? 'Bearbeiten' : 'Nur lesen';
                    const rolleColor = m.isErsteller ? 'var(--green-600)' : m.rolle === 'lesend' ? 'var(--gray-400)' : 'var(--blue-500, #3b82f6)';
                    const rolleIcon = m.isErsteller ? 'bi-shield-fill-check' : m.rolle === 'lesend' ? 'bi-eye' : 'bi-pencil-fill';
                    let rolleHtml = '<span style="font-size:0.7rem;color:' + rolleColor + ';font-weight:600;display:flex;align-items:center;gap:0.2rem"><i class="bi ' + rolleIcon + '"></i> ' + rolleLabel + '</span>';
                    if (isErsteller && !m.isErsteller) {
                        rolleHtml = '<select onchange="changeRolle(' + m.id + ',this.value)" style="font-size:0.75rem;padding:0.15rem 0.3rem;border-radius:4px;border:1px solid var(--gray-200)">' +
                            '<option value="schreibend"' + (m.rolle === 'schreibend' ? ' selected' : '') + '>Bearbeiten</option>' +
                            '<option value="lesend"' + (m.rolle === 'lesend' ? ' selected' : '') + '>Nur lesen</option>' +
                            '</select>';
                    }
                    return '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;font-size:0.9rem;justify-content:space-between">' +
                        '<div style="display:flex;align-items:center;gap:0.4rem"><i class="bi bi-person-fill" style="color:var(--green-600)"></i> ' + esc(m.benutzername) + '</div>' +
                        rolleHtml + '</div>';
                }).join('')}
            </div>
            ${currentUser.haushalt.rolle === 'lesend' ? '<div style="background:var(--gray-100);border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:1rem;font-size:0.8rem;color:var(--gray-500)"><i class="bi bi-eye"></i> Du hast nur Leserechte. Wende dich an den Haushalt-Admin, um Schreibrechte zu erhalten.</div>' : ''}
            <button class="btn btn-danger" style="width:100%" onclick="leaveHaushalt()">
                <i class="bi bi-box-arrow-right"></i> Haushalt verlassen
            </button>`;
    } else {
        body.innerHTML = `
            <p style="color:var(--gray-500);font-size:0.85rem;margin-bottom:1.25rem">
                Erstelle einen Haushalt oder tritt einem bei, um Einkaufsliste, Wochenplan und Rezepte zu teilen.
            </p>
            <div style="margin-bottom:1.25rem">
                <label>Neuen Haushalt erstellen</label>
                <div style="display:flex;gap:0.5rem">
                    <input type="text" id="haushaltName" placeholder="Name (z.B. Familie M\u00FCller)">
                    <button class="btn btn-primary" onclick="createHaushalt()" style="white-space:nowrap">Erstellen</button>
                </div>
            </div>
            <div style="border-top:1px solid var(--gray-200);padding-top:1.25rem">
                <label>Haushalt beitreten</label>
                <div style="display:flex;gap:0.5rem">
                    <input type="text" id="haushaltCode" placeholder="Einladungscode" style="text-transform:uppercase;letter-spacing:0.1em">
                    <button class="btn btn-primary" onclick="joinHaushalt()" style="white-space:nowrap">Beitreten</button>
                </div>
            </div>
            <div id="haushaltError" style="display:none;color:var(--red-500);font-size:0.8rem;font-weight:500;margin-top:0.75rem"></div>`;
    }
}

function closeHaushalt() { document.getElementById('haushaltOverlay').classList.remove('active'); }

// Haushalt inline on Profil page
async function loadHaushaltSection() {
    const section = document.getElementById('haushaltSection');
    if (!section) return;
    section.innerHTML = '<p style="color:var(--gray-400);text-align:center">Laden...</p>';

    const meRes = await fetch('/api/auth/me');
    if (meRes.ok) currentUser = await meRes.json();

    if (currentUser.haushalt) {
        const membersRes = await fetch('/api/haushalt/mitglieder');
        const members = membersRes.ok ? await membersRes.json() : [];
        const isErsteller = currentUser.haushalt.isErsteller;
        section.innerHTML = `
            <div style="margin-bottom:1rem">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.25rem">
                    <span style="font-weight:700;font-size:1rem">${esc(currentUser.haushalt.name)}</span>
                    ${isErsteller ? '<button class="btn-icon" onclick="renameHaushalt()" title="Umbenennen" style="font-size:0.85rem;color:var(--gray-400)"><i class="bi bi-pencil"></i></button>' : ''}
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
                    <span style="font-size:0.8rem;color:var(--gray-500)">Einladungscode:</span>
                    <code style="background:var(--gray-100);padding:0.25rem 0.6rem;border-radius:6px;font-weight:700;font-size:1rem;letter-spacing:0.1em">${esc(currentUser.haushalt.code)}</code>
                    <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${currentUser.haushalt.code}');toast('Code kopiert')" title="Kopieren">
                        <i class="bi bi-clipboard"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="shareHaushaltCode()" title="Teilen">
                        <i class="bi bi-share"></i>
                    </button>
                </div>
            </div>
            <div style="margin-bottom:1rem">
                <div style="font-size:0.8rem;font-weight:600;color:var(--gray-500);margin-bottom:0.4rem">Mitglieder</div>
                ${members.map(m => {
                    const rolleLabel = m.isErsteller ? 'Admin' : m.rolle === 'schreibend' ? 'Bearbeiten' : 'Nur lesen';
                    const rolleColor = m.isErsteller ? 'var(--green-600)' : m.rolle === 'lesend' ? 'var(--gray-400)' : 'var(--blue-500, #3b82f6)';
                    const rolleIcon = m.isErsteller ? 'bi-shield-fill-check' : m.rolle === 'lesend' ? 'bi-eye' : 'bi-pencil-fill';
                    let rolleHtml = '<span style="font-size:0.7rem;color:' + rolleColor + ';font-weight:600;display:flex;align-items:center;gap:0.2rem"><i class="bi ' + rolleIcon + '"></i> ' + rolleLabel + '</span>';
                    if (isErsteller && !m.isErsteller) {
                        rolleHtml = '<select onchange="changeRolle(' + m.id + ',this.value)" style="font-size:0.75rem;padding:0.15rem 0.3rem;border-radius:4px;border:1px solid var(--gray-200)">' +
                            '<option value="schreibend"' + (m.rolle === 'schreibend' ? ' selected' : '') + '>Bearbeiten</option>' +
                            '<option value="lesend"' + (m.rolle === 'lesend' ? ' selected' : '') + '>Nur lesen</option>' +
                            '</select>';
                    }
                    return '<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;font-size:0.9rem;justify-content:space-between">' +
                        '<div style="display:flex;align-items:center;gap:0.4rem"><i class="bi bi-person-fill" style="color:var(--green-600)"></i> ' + esc(m.benutzername) + '</div>' +
                        rolleHtml + '</div>';
                }).join('')}
            </div>
            ${currentUser.haushalt.rolle === 'lesend' ? '<div style="background:var(--gray-100);border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:1rem;font-size:0.8rem;color:var(--gray-500)"><i class="bi bi-eye"></i> Du hast nur Leserechte. Wende dich an den Haushalt-Admin, um Schreibrechte zu erhalten.</div>' : ''}
            <button class="btn btn-danger" style="width:100%" onclick="leaveHaushalt()">
                <i class="bi bi-box-arrow-right"></i> Haushalt verlassen
            </button>`;
    } else {
        section.innerHTML = `
            <p style="color:var(--gray-500);font-size:0.85rem;margin-bottom:1.25rem">
                Erstelle einen Haushalt oder tritt einem bei, um Einkaufsliste, Wochenplan und Rezepte zu teilen.
            </p>
            <div style="margin-bottom:1.25rem">
                <label>Neuen Haushalt erstellen</label>
                <div style="display:flex;gap:0.5rem">
                    <input type="text" id="haushaltName" placeholder="Name (z.B. Familie M\u00FCller)">
                    <button class="btn btn-primary" onclick="createHaushalt()" style="white-space:nowrap">Erstellen</button>
                </div>
            </div>
            <div style="border-top:1px solid var(--gray-200);padding-top:1.25rem">
                <label>Haushalt beitreten</label>
                <div style="display:flex;gap:0.5rem">
                    <input type="text" id="haushaltCode" placeholder="Einladungscode" style="text-transform:uppercase;letter-spacing:0.1em">
                    <button class="btn btn-primary" onclick="joinHaushalt()" style="white-space:nowrap">Beitreten</button>
                </div>
            </div>
            <div id="haushaltError" style="display:none;color:var(--red-500);font-size:0.8rem;font-weight:500;margin-top:0.75rem"></div>`;
    }
}

async function shareHaushaltCode() {
    const code = currentUser?.haushalt?.code;
    const name = currentUser?.haushalt?.name || 'Haushalt';
    if (!code) return;
    const text = 'Tritt meinem Haushalt \"' + name + '\" bei! Einladungscode: ' + code;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Haushalt beitreten', text });
        } catch (e) { /* user cancelled */ }
    } else {
        navigator.clipboard.writeText(text);
        toast('Einladungstext kopiert');
    }
}

async function createHaushalt() {
    const name = document.getElementById('haushaltName').value.trim();
    const errEl = document.getElementById('haushaltError');
    if (!name) { errEl.textContent = 'Bitte einen Namen eingeben.'; errEl.style.display = ''; return; }
    const res = await fetch('/api/haushalt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if (res.ok) {
        toast('Haushalt erstellt!');
        loadHaushaltSection();
        if (typeof loadItems === 'function') loadItems();
    } else {
        const data = await res.json().catch(() => null);
        errEl.textContent = data?.error || 'Fehler beim Erstellen.';
        errEl.style.display = '';
    }
}

async function joinHaushalt() {
    const code = document.getElementById('haushaltCode').value.trim();
    const errEl = document.getElementById('haushaltError');
    if (!code) { errEl.textContent = 'Bitte einen Code eingeben.'; errEl.style.display = ''; return; }
    const res = await fetch('/api/haushalt/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    });
    if (res.ok) {
        const data = await res.json();
        toast(`Haushalt "${data.name}" beigetreten!`);
        loadHaushaltSection();
        if (typeof loadItems === 'function') loadItems();
    } else {
        const data = await res.json().catch(() => null);
        errEl.textContent = data?.error || 'Code nicht gefunden.';
        errEl.style.display = '';
    }
}

async function changeRolle(userId, rolle) {
    const res = await fetch('/api/haushalt/rolle', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, rolle })
    });
    if (res.ok) {
        toast('Rolle ge\u00E4ndert: ' + (rolle === 'lesend' ? 'Nur lesen' : 'Bearbeiten'));
    } else {
        toast('Fehler beim \u00C4ndern der Rolle');
        loadHaushaltSection();
    }
}

async function renameHaushalt() {
    const currentName = currentUser?.haushalt?.name || '';
    const newName = prompt('Neuer Name für den Haushalt:', currentName);
    if (!newName || newName.trim() === currentName) return;
    const res = await fetch('/api/haushalt/name', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
    });
    if (res.ok) {
        toast('Haushalt umbenannt');
        loadHaushaltSection();
    } else {
        const data = await res.json().catch(() => null);
        toast(data?.error || 'Fehler beim Umbenennen', true);
    }
}

async function leaveHaushalt() {
    if (!confirm('Möchtest du den Haushalt wirklich verlassen?')) return;
    await fetch('/api/haushalt/leave', { method: 'POST' });
    toast('Haushalt verlassen');
    loadHaushaltSection();
    if (typeof loadItems === 'function') loadItems();
}

// -- Nav Dropdown --
function toggleNavDropdown(e) {
    e.stopPropagation();
    document.getElementById('navDropdownMenu').classList.toggle('open');
}

function closeNavDropdown() {
    document.getElementById('navDropdownMenu').classList.remove('open');
}

document.addEventListener('click', (e) => {
    closeNavDropdown();
    // Close expanded sidebar on click outside
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('expanded') && !sidebar.contains(e.target)) {
        sidebar.classList.remove('expanded');
    }
});

// -- Sidebar Toggle --
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('expanded');
}

// -- Password toggle --
function initPasswordToggles() {
    document.querySelectorAll('input[type="password"]').forEach(input => {
        if (input.parentElement.classList.contains('pw-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'pw-wrap';
        wrap.style.cssText = 'position:relative;display:flex;align-items:center';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        input.style.paddingRight = '2.2rem';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.tabIndex = -1;
        btn.className = 'pw-toggle';
        btn.style.cssText = 'position:absolute;right:0.5rem;background:none;border:none;cursor:pointer;color:var(--gray-400);font-size:1rem;padding:0.2rem;display:flex;align-items:center';
        btn.innerHTML = '<i class="bi bi-eye"></i>';
        btn.onclick = function() {
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            btn.innerHTML = isHidden ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
        };
        wrap.appendChild(btn);
    });
}
document.addEventListener('DOMContentLoaded', initPasswordToggles);

// ── WebAuthn / FIDO2 Functions ──────────────────────────────────────

async function initWebauthnLogin() {
  const verfuegbar = await WebAuthnClient.istVerfuegbar();
  if (!verfuegbar) return;
  // Automatisch biometrischen Login starten, wenn Gerät bereits registriert ist
  const registrierterUser = WebAuthnClient.getRegistriertenBenutzer();
  if (!registrierterUser) return;
  try {
    const result = await WebAuthnClient.starteAnmeldung(registrierterUser);
    currentUser = result.benutzer;
    showApp();
  } catch (e) {
    // Stil: Fehler nicht anzeigen beim Auto-Login, Benutzer kann normal mit Passwort fortfahren
    if (e.name !== 'NotAllowedError') {
      console.warn('Automatischer biometrischer Login fehlgeschlagen:', e.message);
    }
  }
}

function ensureWebauthnPrompt() {
  if (document.getElementById('webauthnPromptOverlay')) return;
  const div = document.createElement('div');
  div.innerHTML = `<div class="modal-overlay" id="webauthnPromptOverlay" style="display:none;">
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <h2><i class="bi bi-fingerprint"></i> Biometrie einrichten</h2>
        <button class="modal-close" onclick="webauthnPromptAblehnen()">&times;</button>
      </div>
      <div class="modal-body">
        <p>Möchtest du beim nächsten Mal Fingerabdruck oder Face ID zum Anmelden nutzen?</p>
        <div style="margin-bottom:12px;">
          <label for="webauthnGeraetename">Gerätename</label>
          <input type="text" id="webauthnGeraetename" placeholder="z.B. Mein iPhone" maxlength="100">
        </div>
        <div id="webauthnPromptError" style="display:none;color:var(--red-500);margin-bottom:8px;"></div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" style="flex:1;" onclick="webauthnPromptAnnehmen()">
            <i class="bi bi-fingerprint"></i> Ja, einrichten
          </button>
          <button class="btn btn-secondary" style="flex:1;" onclick="webauthnPromptAblehnen()">
            Später
          </button>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(div.firstElementChild);
}

async function webauthnNachLoginPruefen() {
  try {
    const verfuegbar = await WebAuthnClient.istVerfuegbar();
    if (!verfuegbar) return;
    const benutzername = currentUser && currentUser.benutzername;
    if (!benutzername) return;
    if (!WebAuthnClient.sollPromptZeigen(benutzername)) return;
    ensureWebauthnPrompt();
    document.getElementById('webauthnPromptOverlay').style.display = '';
    // Gerätename-Vorschlag basierend auf User-Agent
    const ua = navigator.userAgent;
    let vorschlag = 'Mein Gerät';
    if (/iPhone/i.test(ua)) vorschlag = 'iPhone';
    else if (/iPad/i.test(ua)) vorschlag = 'iPad';
    else if (/Android/i.test(ua)) vorschlag = 'Android';
    else if (/Windows/i.test(ua)) vorschlag = 'Windows PC';
    else if (/Mac/i.test(ua)) vorschlag = 'Mac';
    document.getElementById('webauthnGeraetename').value = vorschlag;
  } catch (e) {
    console.error('WebAuthn Prompt Fehler:', e);
  }
}

async function webauthnPromptAnnehmen() {
  const geraetename = document.getElementById('webauthnGeraetename').value.trim();
  const errorEl = document.getElementById('webauthnPromptError');
  if (!geraetename) {
    errorEl.textContent = 'Bitte Gerätename eingeben.';
    errorEl.style.display = '';
    return;
  }
  errorEl.style.display = 'none';
  try {
    await WebAuthnClient.starteRegistrierung(geraetename);
    WebAuthnClient.markiereRegistriert(currentUser.benutzername);
    document.getElementById('webauthnPromptOverlay').style.display = 'none';
    alert('Biometrische Anmeldung erfolgreich eingerichtet!');
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      errorEl.textContent = 'Einrichtung abgebrochen. Du kannst es jederzeit im Profil erneut versuchen.';
    } else {
      errorEl.textContent = e.message || 'Einrichtung fehlgeschlagen.';
    }
    errorEl.style.display = '';
  }
}

function webauthnPromptAblehnen() {
  if (currentUser && currentUser.benutzername) {
    WebAuthnClient.markiereAbgelehnt(currentUser.benutzername);
  }
  document.getElementById('webauthnPromptOverlay').style.display = 'none';
}

// WebAuthn: Profil - Geräte verwalten
async function webauthnLadeGeraeteProfil() {
  const section = document.getElementById('webauthnGeraeteSection');
  const nichtVerfuegbar = document.getElementById('webauthnNichtVerfuegbar');
  if (!section || !nichtVerfuegbar) return;

  const verfuegbar = await WebAuthnClient.istVerfuegbar();
  if (!verfuegbar) {
    nichtVerfuegbar.style.display = '';
    section.style.display = 'none';
    return;
  }

  nichtVerfuegbar.style.display = 'none';
  section.style.display = '';

  try {
    const geraete = await WebAuthnClient.ladeGeraete();
    const liste = document.getElementById('webauthnGeraeteListe');
    if (geraete.length === 0) {
      liste.innerHTML = '<p style="color:var(--text-muted);">Keine Geräte registriert.</p>';
      return;
    }
    liste.innerHTML = geraete.map(g => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-color);">
        <div>
          <strong>${esc(g.geraetename)}</strong><br>
          <small style="color:var(--text-muted);">${new Date(g.erstelltAm).toLocaleDateString('de-CH')}</small>
        </div>
        <button class="btn btn-danger btn-sm" onclick="webauthnGeraetEntfernen(${g.id}, '${esc(g.geraetename)}')">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `).join('');
  } catch (e) {
    console.error('Fehler beim Laden der Geräte:', e);
  }
}

async function webauthnGeraetEntfernen(id, name) {
  if (!confirm('Gerät "' + name + '" wirklich entfernen?')) return;
  try {
    await WebAuthnClient.loescheGeraet(id);
    webauthnLadeGeraeteProfil();
  } catch (e) {
    alert(e.message || 'Fehler beim Entfernen.');
  }
}

async function webauthnNeuesGeraet() {
  const name = prompt('Gerätename:');
  if (!name || !name.trim()) return;
  try {
    await WebAuthnClient.starteRegistrierung(name.trim());
    WebAuthnClient.markiereRegistriert(currentUser.benutzername);
    webauthnLadeGeraeteProfil();
    alert('Gerät erfolgreich registriert!');
  } catch (e) {
    if (e.name !== 'NotAllowedError') {
      alert(e.message || 'Registrierung fehlgeschlagen.');
    }
  }
}
