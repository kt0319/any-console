// このSWはプッシュ通知専用。オフラインキャッシュは廃止した（docs/DECISIONS.md ADR 10 の Update 参照）。

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.map((name) => {
          // 旧SWが作ったオフラインキャッシュ（any-console-<hash>）を掃除する。通知設定のキャッシュは残す。
          if (name !== NOTIF_PREFS_CACHE) return caches.delete(name);
        })
      )
    )
  );
  self.clients.claim();
});

// 通知タイプごとの表示設定（sync-notif-prefs で同期）。SWはアイドルで停止され push のたびに再起動されるため、
// Cache Storageへ永続化し push 時に読み直す。
const NOTIF_PREFS_CACHE = 'any-console-notif-prefs';
const NOTIF_PREFS_URL = '/__notif-prefs__';
const DEFAULT_NOTIF_PREFS = { dispatch: true, phrase: true, blocked: true };

async function saveNotifPrefs(prefs) {
  try {
    const cache = await caches.open(NOTIF_PREFS_CACHE);
    await cache.put(NOTIF_PREFS_URL, new Response(JSON.stringify(prefs)));
  } catch (_e) {}
}

async function loadNotifPrefs() {
  try {
    const cache = await caches.open(NOTIF_PREFS_CACHE);
    const res = await cache.match(NOTIF_PREFS_URL);
    if (res) return { ...DEFAULT_NOTIF_PREFS, ...(await res.json()) };
  } catch (_e) {}
  return { ...DEFAULT_NOTIF_PREFS };
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'sync-notif-prefs') {
    const prefs = { ...event.data.prefs };
    if (event.waitUntil) event.waitUntil(saveNotifPrefs(prefs));
    else saveNotifPrefs(prefs);
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'any-console', body: '', url: '/', type: '' };
  try {
    if (event.data) Object.assign(data, JSON.parse(event.data.text()));
  } catch (_e) {}
  event.waitUntil((async () => {
    const prefs = await loadNotifPrefs();
    if (data.type && prefs[data.type] === false) return;
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url, type: data.type },
    });
  })());
});

// iOS Safari の PWA は凍結したページへの postMessage が届かないことがあるため、
// ack が無ければ URL 遷移にフォールバックする（vue-main.ts の起動時チェックが openDispatchQueue クエリを見て開く）。
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

// existing.navigate() は WebKit(iOS Safari) で未対応/例外になるため、失敗時は openWindow にフォールバックする。
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
    // dispatch通知は承認待ちが積まれる Settings の Dispatch Queue を開かせる（項目も伝える）。
    if (type === 'dispatch') {
      const acked = await postMessageWithAck(existing, { type: 'notification-open-dispatch-queue', dispatchId });
      if (!acked) await navigateOrOpen(existing, url);
    } else if (sessionId) {
      existing.postMessage({ type: 'notification-navigate', sessionId });
    }
  }

  event.waitUntil(handle());
});
