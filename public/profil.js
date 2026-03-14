function showApp() {
    showAppBase();
    document.getElementById('profilUser').value = currentUser?.benutzername || '';
    document.getElementById('profilEmail').value = currentUser?.email || '';
    loadHaushaltSection();
    if (typeof WebAuthnClient !== 'undefined') webauthnLadeGeraeteProfil();
}

function togglePasswordSection() {
    const section = document.getElementById('passwordSection');
    const icon = document.getElementById('pwToggleIcon');
    const open = section.style.display !== 'none';
    section.style.display = open ? 'none' : '';
    icon.className = open ? 'bi bi-chevron-down' : 'bi bi-chevron-up';
}

if (!_redirecting) checkAuth(showApp);
