const CACHE_NAME = 'kzar-offline-v1';
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './logo.png'
];
const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/handsontable/dist/handsontable.full.min.js',
    'https://cdn.jsdelivr.net/npm/handsontable/dist/handsontable.full.min.css',
    'https://unpkg.com/lucide@latest',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

async function fetchWithTimeout(request, timeout = 4000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(request, { signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(APP_SHELL);
        await Promise.all(CDN_ASSETS.map(async url => {
            try {
                const response = await fetchWithTimeout(url);
                if (response.ok || response.type === 'opaque') {
                    await cache.put(url, response);
                }
            } catch (error) {
                console.warn('Nie udało się zapisać biblioteki do trybu offline:', url, error);
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames
            .filter(name => name.startsWith('kzar-offline-') && name !== CACHE_NAME)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const isAppAsset = url.origin === self.location.origin;
    const isCdnAsset = CDN_ASSETS.some(asset => new URL(asset).origin === url.origin);
    if (!isAppAsset && !isCdnAsset) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request, { ignoreSearch: true });

        if (isAppAsset) {
            try {
                const response = await fetchWithTimeout(request);
                if (response.ok) {
                    try {
                        await cache.put(request, response.clone());
                    } catch (error) {
                        console.warn('Nie udało się odświeżyć pamięci aplikacji offline:', error);
                    }
                }
                return response;
            } catch (error) {
                if (cached) return cached;
                if (request.mode === 'navigate') {
                    const appShell = await cache.match('./index.html');
                    if (appShell) return appShell;
                }
                throw error;
            }
        }

        if (cached) return cached;

        try {
            const response = await fetchWithTimeout(request, 1500);
            if (response.ok || response.type === 'opaque') {
                try {
                    await cache.put(request, response.clone());
                } catch (error) {
                    console.warn('Nie udało się zapisać biblioteki offline:', error);
                }
            }
            return response;
        } catch (error) {
            if (request.mode === 'navigate') {
                const appShell = await cache.match('./index.html');
                if (appShell) return appShell;
            }
            throw error;
        }
    })());
});
