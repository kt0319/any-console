// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useCircleKeyPadConfigStore } from "../../ui/stores/circle-keypad-config.ts";
import { useAuthStore } from "../../ui/stores/auth.ts";
import { defaultKeyDefs } from "../../ui/utils/circle-keypad-presets.ts";

const okRes = (body) => ({ ok: true, json: async () => body });
const failRes = { ok: false, json: async () => ({}) };

function customKeys() {
  return defaultKeyDefs().map((k, i) => ({ ...k, label: `custom${i}` }));
}

describe("circle-keypad-config store: load 堅牢化", () => {
  let store;
  let auth;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useCircleKeyPadConfigStore();
    auth = useAuthStore();
  });

  it("成功時はサーバ設定を反映し loaded=true", async () => {
    const keys = customKeys();
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({ keys, specials: [], enabled: true }));
    await store.load();
    expect(auth.apiFetch).toHaveBeenCalledTimes(1);
    expect(store.loaded).toBe(true);
    expect(store.keys[0].label).toBe("custom0");
  });

  it("初回失敗 → リトライ成功で反映（リセットに見えない）", async () => {
    const keys = customKeys();
    auth.apiFetch = vi.fn()
      .mockResolvedValueOnce(failRes)
      .mockResolvedValueOnce(okRes({ keys, specials: [], enabled: true }));
    await store.load();
    expect(auth.apiFetch).toHaveBeenCalledTimes(2);
    expect(store.loaded).toBe(true);
    expect(store.keys[0].label).toBe("custom0");
  });

  it("2回とも失敗なら loaded を立てない（defaults を確定させない）", async () => {
    auth.apiFetch = vi.fn().mockRejectedValue(new Error("network"));
    await store.load();
    expect(auth.apiFetch).toHaveBeenCalledTimes(2);
    expect(store.loaded).toBe(false);
  });

  it("res.ok かつ空配列（未保存）は defaults を採用し loaded=true・リトライしない", async () => {
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({ keys: [], specials: [], enabled: true }));
    await store.load();
    expect(auth.apiFetch).toHaveBeenCalledTimes(1);
    expect(store.loaded).toBe(true);
    expect(store.keys).toEqual(defaultKeyDefs());
  });
});
