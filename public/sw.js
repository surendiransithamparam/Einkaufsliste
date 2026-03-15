const CACHE_NAME = 'einkaufsliste-v21';
const ASSETS = [
    './',
    './index.html',
    './about.html',
    './register.html',
    './reset.html',
    './rezepte.html',
    './wochenplan.html',
    './tankrabatte.html',
    './profil.html',
    './profil.js',
    './kundenkarten.html',
    './kundenkarten.js',
    './app.css',
    './app.js',
    './shared.js',
    './webauthn.js',
    './lib/simplewebauthn-browser.min.js',
    './rezepte.js',
    './wochenplan.js',
    './wochenplan.css',
    './tankrabatte.js',
    './tankrabatte.css',
    './manifest.json',
    './icons/icon-192.svg',
    './icons/icon-512.svg',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css'
];

// Install: cache all assets
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch: network first, fallback to cache (only cache static assets, not API)
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') {
        e.respondWith(fetch(e.request));
        return;
    }

    // Skip caching for API requests
    if (e.request.url.includes('/api/')) {
        e.respondWith(fetch(e.request));
        return;
    }

    e.respondWith(
        fetch(e.request)
            .then(response => {
                // Cache successful GET responses (static assets only)
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(e.request))
    );
});
