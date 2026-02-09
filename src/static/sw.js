/**
 * Service Worker for Obsidian Notes Publisher PWA
 */

const CACHE_NAME = 'obsidian-publisher-v3';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/about.html',
    '/feedback.html',
    '/styles/main.css',
    '/scripts/app.js',
    '/scripts/tabs.js',
    '/scripts/search.js',
    '/scripts/export.js',
    '/scripts/settings.js',
    '/scripts/typography.js',
    '/scripts/auth-ui.js',
    '/scripts/comments-ui.js',
    '/scripts/analytics-dashboard.js',
    '/manifest.json',
    '/icon.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;

    // Keep API requests network-first.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request).catch(() => new Response(
                JSON.stringify({ error: 'Offline', offline: true }),
                {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                }
            ))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) {
                event.waitUntil(
                    fetch(request)
                        .then((response) => {
                            if (response.ok) {
                                return caches.open(CACHE_NAME)
                                    .then((cache) => cache.put(request, response));
                            }
                            return null;
                        })
                        .catch(() => null)
                );
                return cached;
            }

            return fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const cloned = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
                    }
                    return response;
                })
                .catch(() => {
                    if (request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                    return new Response('Offline', { status: 503 });
                });
        })
    );
});

self.addEventListener('push', (event) => {
    if (!event.data) return;

    const data = event.data.json();
    const options = {
        body: data.body || 'New update available',
        icon: '/icon.svg',
        badge: '/icon.svg',
        data: {
            url: data.url || '/'
        },
        actions: [
            { action: 'open', title: 'Open' },
            { action: 'close', title: 'Dismiss' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'Obsidian Notes', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'close') return;

    const url = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        client.navigate(url);
                        return client.focus();
                    }
                }
                return clients.openWindow(url);
            })
    );
});
