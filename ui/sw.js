const CACHE_NAME = 'any-console-__BUILD_HASH__';
// precache 対象はビルド時に vite.config.js が dist/ を走査して注入する
// （__PRECACHE_ASSETS__ を JSON 配列へ置換）。手で一覧を保守しない。
// dev（未ビルドの素の sw.js を直接読む経路）では置換が走らないため空配列にフォールバックする。
const ASSETS_TO_CACHE = (() => {
  const injected = '__PRECACHE_ASSETS__';
  try {
    const list = JSON.parse(injected);
    return Array.isArray(list) ? list : [];
  } catch (_e) {
    return [];
  }
})();

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

self.addEventListener('push', (event) => {
  let data = { title: 'any-console', body: '', url: '/' };
  try {
    if (event.data) Object.assign(data, JSON.parse(event.data.text()));
  } catch (_e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
      } else {
        self.clients.openWindow(url);
      }
    })
  );
});

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
