// @vitest-environment happy-dom
// @ts-check
/**
 * usePushNotification: subscribe()の失敗系。
 * ブラウザ側の購読だけ残って「完了」表示のまま実際には通知が届かない状態
 * （サーバ登録失敗時）を防げているかを確認する。
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

  // subscriptionはモジュールスコープの singleton のため、
  // 「サーバ登録失敗時はisSubscribedがfalseのまま」を先に確認してから成功系を検証する
  // （成功系を先に走らせるとsubscription.valueが残り、この後始末不要な検証ができなくなる）。
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
