const CACHE_NAME = 'any-console-__BUILD_HASH__';
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

// 同一オリジンでキャッシュ対象にする静的アセットの allowlist。
// ここに該当しないリクエスト（API ルート・動的リソース）はネットワークへ素通しし、
// SW では一切キャッシュしない。つまり API ルートを追加・変更してもデフォルトで
// 安全側（非キャッシュ）に倒れる。allowlist の更新漏れで起きうるのは「キャッシュ
// されず素通し（＝正しい挙動）」だけで、API レスポンスが stale になる事故は起きない。
// 新しい静的アセットの配信パスを増やしたときだけ、この一覧を更新する。
const STATIC_ASSET_PREFIXES = ['/assets/', '/vendor/', '/fonts/'];
const STATIC_ASSET_PATHS = new Set([
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
]);

function isCacheableAsset(request, url) {
  if (request.method !== 'GET') return false;
  if (request.mode === 'navigate') return true;
  if (STATIC_ASSET_PATHS.has(url.pathname)) return true;
  return STATIC_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // WebSocket アップグレードは SW では扱わない。
  if (event.request.headers.get('Upgrade') === 'websocket') return;

  // クロスオリジンはピン留めした CDN だけ cache-first、それ以外は素通し。
  if (url.origin !== self.location.origin) {
    if (url.hostname !== 'cdn.jsdelivr.net') return;
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

  // 同一オリジンは「既知の静的アセットだけ」を network-first でキャッシュする。
  // それ以外（API ルート・動的リソース）は素通しし、SW のキャッシュ対象にしない。
  if (!isCacheableAsset(event.request, url)) return;

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
