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

// 通知タイプごとの表示設定。ページから sync-notif-prefs メッセージで同期する。
let _notifPrefs = { dispatch: true, phrase: true, job_done: true };

self.addEventListener('message', (event) => {
  if (event.data?.type === 'sync-notif-prefs') {
    _notifPrefs = { ...event.data.prefs };
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'any-console', body: '', url: '/', type: '' };
  try {
    if (event.data) Object.assign(data, JSON.parse(event.data.text()));
  } catch (_e) {}
  if (data.type && _notifPrefs[data.type] === false) return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url, type: data.type },
    })
  );
});

// 既存タブへの postMessage が届いたかを ack で確認するタイムアウト（ms）。
// iOS Safari の PWA はバックグラウンドで凍結したページへの postMessage が
// 届かないことがあるため、一定時間内に ack が無ければ URL 遷移にフォールバックする
// （vue-main.js の起動時チェックが openDispatchQueue クエリを見て開く）。
const NOTIFICATION_ACK_TIMEOUT_MS = 800;

function postMessageWithAck(client, message) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    channel.port1.onmessage = () => {
      if (settled) return;
      settled = true;
      resolve(true);
    };
    try {
      client.postMessage(message, [channel.port2]);
    } catch (_e) {
      settled = true;
      resolve(false);
      return;
    }
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, NOTIFICATION_ACK_TIMEOUT_MS);
  });
}

// existing.navigate() は WebKit(iOS Safari) では未対応/例外になることがあるため、
// 失敗時は新規ウィンドウ相当（openWindow）に確実にフォールバックする。
async function navigateOrOpen(existing, url) {
  try {
    const navigated = await existing.navigate(url);
    if (navigated) return;
  } catch (_e) { /* navigate 未対応 */ }
  try {
    await self.clients.openWindow(url);
  } catch (_e) { /* 最後の手段も失敗したら諦める */ }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  const type = event.notification.data?.type || '';
  let sessionId = null;
  let dispatchId = null;
  try {
    const parsed = new URL(url, self.location.origin);
    sessionId = parsed.searchParams.get('session');
    dispatchId = parsed.searchParams.get('dispatchId');
  } catch (_e) {}

  async function handle() {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clientList.find((c) => c.url.includes(self.location.origin));
    if (!existing) {
      try {
        await self.clients.openWindow(url);
      } catch (_e) { /* ignore */ }
      return;
    }
    existing.focus();
    // dispatch通知はセッションへ飛ばさず、Settingsの Dispatch Queue を開かせる
    // （承認待ちが積まれているのはそこなので）。どの項目かも一緒に伝える。
    if (type === 'dispatch') {
      const acked = await postMessageWithAck(existing, { type: 'notification-open-dispatch-queue', dispatchId });
      if (!acked) await navigateOrOpen(existing, url);
    } else if (sessionId) {
      existing.postMessage({ type: 'notification-navigate', sessionId });
    }
  }

  event.waitUntil(handle());
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
