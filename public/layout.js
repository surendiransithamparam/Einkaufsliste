// -- Shared layout components (navbar, sidebar, login) --

const SIDEBAR_LINKS = [
    { href: 'index.html', icon: 'bi-cart3', label: 'Einkauf' },
    { href: 'wochenplan.html', icon: 'bi-calendar-week', label: 'Woche' },
    { href: 'rezepte.html', icon: 'bi-book', label: 'Rezepte' },
    { href: 'tankrabatte.html', icon: 'bi-tag', label: 'Aktionen' },
    { href: 'kundenkarten.html', icon: 'bi-credit-card', label: 'Karten' },
    { href: 'profil.html', icon: 'bi-person', label: 'Profil' },
];

function injectNavbar(extraMenuHtml) {
    const el = document.getElementById('navbar');
    if (!el) return;
    el.outerHTML = `<nav class="navbar">
    <div class="navbar-left">
        <a href="index.html" class="btn-nav btn-nav-icon" title="Startseite" aria-label="Startseite"><i class="bi bi-house-door-fill"></i></a>
    </div>
    <div class="navbar-center">
        <span class="navbar-brand">Haushalt<sup>+</sup></span>
    </div>
    <div class="navbar-right">
        <div class="nav-dropdown" id="navDropdown">
            <button class="btn-nav btn-nav-icon" onclick="toggleNavDropdown(event)" title="Menü" aria-label="Menü">
                <i class="bi bi-three-dots-vertical"></i>
            </button>
            <div class="nav-dropdown-menu" id="navDropdownMenu">
                ${extraMenuHtml || ''}
                <button onclick="logout();closeNavDropdown()" id="logoutBtn" style="display:none">
                    <i class="bi bi-box-arrow-left"></i> Abmelden
                </button>
                <button onclick="openBugReport();closeNavDropdown()">
                    <i class="bi bi-bug"></i> Bug melden
                </button>
                <a href="about.html" style="text-decoration:none">
                    <i class="bi bi-info-circle"></i> Über
                </a>
            </div>
        </div>
    </div>
</nav>`;
}

function injectSidebar(extraLinks) {
    const el = document.getElementById('sidebar');
    if (!el) return;
    const page = location.pathname.split('/').pop() || 'index.html';
    const allLinks = extraLinks ? SIDEBAR_LINKS.concat(extraLinks) : SIDEBAR_LINKS;
    el.outerHTML = `<aside class="sidebar hidden" id="sidebar">
    <button class="sidebar-toggle" onclick="toggleSidebar()" title="Menü ein-/ausblenden" aria-label="Menü ein-/ausblenden">
        <i class="bi bi-list"></i>
    </button>
    <nav class="sidebar-nav" role="navigation" aria-label="Hauptnavigation">
        ${allLinks.map(l =>
            `<a href="${l.href}" class="sidebar-link${page === l.href ? ' active' : ''}"><i class="bi ${l.icon}"></i> <span>${l.label}</span></a>`
        ).join('\n        ')}
    </nav>
</aside>`;
}

function injectLogin(icon) {
    const el = document.getElementById('loginScreen');
    if (!el) return;
    el.outerHTML = `<div id="loginScreen" class="login-screen">
    <div class="login-card">
        <div class="login-header">
            <i class="bi ${icon || 'bi-house-door-fill'}" style="font-size:2.5rem;color:var(--green-600)"></i>
            <h1 style="font-size:1.5rem;margin-top:0.5rem">Haushalt<sup>+</sup></h1>
            <p style="color:var(--gray-500);font-size:0.85rem;margin-top:0.25rem">Anmelden</p>
        </div>
        <form onsubmit="submitAuth(event)">
            <div class="login-form">
                <div>
                    <label for="authUser">Benutzername</label>
                    <input type="text" id="authUser" required autocomplete="username" placeholder="Benutzername">
                </div>
                <div>
                    <label for="authPass">Passwort</label>
                    <input type="password" id="authPass" required autocomplete="current-password" placeholder="Passwort">
                </div>
                <div id="authError" class="auth-message auth-error"></div>
                <div id="authSuccess" class="auth-message auth-success"></div>
                <button type="submit" class="btn btn-primary btn-login">
                    <i class="bi bi-box-arrow-in-right"></i> Anmelden
                </button>
                <a href="register.html" class="btn btn-secondary btn-login" style="text-decoration:none;text-align:center">
                    <i class="bi bi-person-plus"></i> Registrieren
                </a>
            </div>
        </form>
    </div>
</div>`;
}

function injectToasts() {
    if (!document.getElementById('toasts')) {
        document.body.insertAdjacentHTML('beforeend', '<div class="toast-container" id="toasts"></div>');
    }
}

function initLayout(opts) {
    injectNavbar(opts && opts.extraMenu);
    injectSidebar(opts && opts.extraSidebarLinks);
    injectLogin(opts && opts.loginIcon);
    injectToasts();
}
