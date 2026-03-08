const CACHE_NAME = 'pi-console-__BUILD_HASH__';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './vendor/js/highlight.min.js',
  './vendor/js/xterm.js',
  './vendor/js/addon-fit.js',
  './vendor/js/addon-web-links.js',
  './vendor/css/materialdesignicons.min.css',
  './vendor/css/xterm.css',
  './vendor/css/tokyo-night-dark.min.css',
  './vendor/fonts/materialdesignicons-webfont.woff2',
  './vendor/fonts/materialdesignicons-webfont.woff',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/run') ||
    url.pathname.startsWith('/workspaces') ||
    url.pathname.startsWith('/github/') ||
    url.pathname.startsWith('/terminal/') ||
    url.pathname.startsWith('/upload-image') ||
    url.pathname.startsWith('/system/') ||
    url.pathname.startsWith('/settings/') ||
    url.pathname.startsWith('/logs') ||
    url.pathname.startsWith('/icons/') ||
    event.request.headers.get('Upgrade') === 'websocket'
  ) {
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200 && response.type === 'cors') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
