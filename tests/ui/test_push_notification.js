// @vitest-environment happy-dom
// @ts-check
/**
 * usePushNotification: subscribe()の失敗系。
 * サーバ登録失敗時に、購読だけ残って「完了」表示のまま通知が届かない状態を防げているか。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAuthStore } from "../../ui/stores/auth.ts";

/** @type {typeof import("../../ui/composables/usePushNotification.ts").usePushNotification} */
let usePushNotification;
let fakeSubscription;
let fakeRegistration;

beforeAll(async () => {
  class FakeNotification {
    static permission = "granted";
    static requestPermission = vi.fn(async () => FakeNotification.permission);
  }
  // @ts-ignore テスト環境でグローバルAPIを差し込む
  globalThis.Notification = FakeNotification;
  // @ts-ignore
  globalThis.PushManager = class {};

  fakeSubscription = {
    endpoint: "https://push.example/abc",
    toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
  fakeRegistration = {
    pushManager: {
      subscribe: vi.fn(async () => fakeSubscription),
      getSubscription: vi.fn(async () => null),
    },
  };
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    value: { ready: Promise.resolve(fakeRegistration) },
    configurable: true,
  });

  // モジュールスコープの _supported はimport時に評価されるため、グローバルを
  // 差し込んだ後に動的importする。
  ({ usePushNotification } = await import("../../ui/composables/usePushNotification.ts"));
});

function mockAuthFetch({ vapidOk = true, subscribeOk = true } = {}) {
  const auth = useAuthStore();
  auth.apiFetch = vi.fn(async (url, init) => {
    if (String(url).includes("/push/vapid-public-key")) {
      return vapidOk
        ? { ok: true, json: async () => ({ publicKey: "AAAA" }) }
        : { ok: false };
    }
    if (String(url).includes("/push/subscribe") && init?.method === "POST") {
      return { ok: subscribeOk };
    }
    return { ok: true, json: async () => ({}) };
  });
  return auth;
}

describe("usePushNotification.subscribe()", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    fakeRegistration.pushManager.subscribe.mockClear();
    fakeSubscription.unsubscribe.mockClear();
  });

  // subscriptionはモジュールスコープの singleton のため、サーバ登録失敗時の検証を成功系より先に行う。
  it("サーバ登録に失敗した時はブラウザ側の購読を戻し、okをfalseにする", async () => {
    mockAuthFetch({ subscribeOk: false });
    const { subscribe, isSubscribed } = usePushNotification();
    const result = await subscribe();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/server/i);
    expect(fakeSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(isSubscribed.value).toBe(false);
  });

  it("成功時はokを返す", async () => {
    mockAuthFetch({ subscribeOk: true });
    const { subscribe, isSubscribed } = usePushNotification();
    const result = await subscribe();
    expect(result.ok).toBe(true);
    expect(isSubscribed.value).toBe(true);
  });
});
