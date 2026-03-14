function showApp() {
    showAppBase();
    document.getElementById('profilUser').value = currentUser?.benutzername || '';
    document.getElementById('profilEmail').value = currentUser?.email || '';
    if (typeof WebAuthnClient !== 'undefined') webauthnLadeGeraeteProfil();
}

if (!_redirecting) checkAuth(showApp);
