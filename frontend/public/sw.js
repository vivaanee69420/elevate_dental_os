// Kill-switch service worker.
//
// A previous dev session on the same origin may have installed a real SW that
// caches /_next/static/* aggressively. When the cached entries 404 (after a
// rebuild), the page renders raw HTML with no CSS/JS. This file overrides any
// such worker at /sw.js: on activate it nukes every cache, unregisters itself,
// and force-reloads open clients. fetch() is pass-through (no caching at all).

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
            await self.registration.unregister();
            const clients = await self.clients.matchAll({ type: 'window' });
            clients.forEach((c) => {
                try { c.navigate(c.url); } catch (_) { /* cross-origin */ }
            });
        } catch (err) {
            console.warn('[sw] kill-switch activate failed', err);
        }
    })());
});

// Pass-through. We never cache. We never intercept. Network owns everything.
self.addEventListener('fetch', () => { /* no-op */ });
