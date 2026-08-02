// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useInfoPillConfigStore } from "../../ui/stores/info-pill-config.js";
import { useAuthStore } from "../../ui/stores/auth.js";

const okRes = (body) => ({ ok: true, json: async () => body });
const failRes = { ok: false, json: async () => ({}) };

const ALL_TRUE = {
  branch: true, history: true, prs: true, changes: true, pull_push: true,
  devserver: true, files: true, add: true,
};

describe("info-pill-config store: load 堅牢化", () => {
  let store;
  let auth;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useInfoPillConfigStore();
    auth = useAuthStore();
  });

  it("成功時はサーバ設定を反映し loaded=true", async () => {
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({ ...ALL_TRUE, branch: false }));
    await store.load();
    expect(auth.apiFetch).toHaveBeenCalledTimes(1);
    expect(store.loaded).toBe(true);
    expect(store.branch).toBe(false);
    expect(store.changes).toBe(true);
  });

  it("初回失敗 → リトライ成功で反映（リセットに見えない）", async () => {
    auth.apiFetch = vi.fn()
      .mockResolvedValueOnce(failRes)
      .mockResolvedValueOnce(okRes({ ...ALL_TRUE, add: false }));
    await store.load();
    expect(auth.apiFetch).toHaveBeenCalledTimes(2);
    expect(store.loaded).toBe(true);
    expect(store.add).toBe(false);
  });

  it("2回とも失敗なら loaded を立てない（defaults を確定させない）", async () => {
    auth.apiFetch = vi.fn().mockRejectedValue(new Error("network"));
    await store.load();
    expect(auth.apiFetch).toHaveBeenCalledTimes(2);
    expect(store.loaded).toBe(false);
  });

  it("res.ok かつ空オブジェクト（未保存）は defaults(true) を採用し loaded=true・リトライしない", async () => {
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({}));
    await store.load();
    expect(auth.apiFetch).toHaveBeenCalledTimes(1);
    expect(store.loaded).toBe(true);
    expect(store.branch).toBe(true);
    expect(store.files).toBe(true);
  });

  it("save は現在の各フィールド値をまとめてPUTする", async () => {
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({ status: "ok" }));
    store.branch = false;
    store.pull_push = false;
    await store.save();
    expect(auth.apiFetch).toHaveBeenCalledWith("/settings/info-pills", {
      method: "PUT",
      body: { ...ALL_TRUE, branch: false, pull_push: false },
    });
  });
});
