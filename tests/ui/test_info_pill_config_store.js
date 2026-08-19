// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useInfoPillConfigStore } from "../../ui/stores/info-pill-config.ts";
import { useAuthStore } from "../../ui/stores/auth.ts";

const okRes = (body) => ({ ok: true, json: async () => body });
const failRes = { ok: false, json: async () => ({}) };

const DEFAULT_ORDER = ["files", "changes", "branch", "prs", "actions", "devserver", "add", "dispatch"];

const ALL_TRUE = {
  branch: true, prs: true, actions: true, changes: true,
  devserver: true, files: true, add: true, dispatch: true,
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
    expect(store.order).toEqual(DEFAULT_ORDER);
  });

  it("load はサーバのorderを反映する", async () => {
    const customOrder = ["branch", "files", "changes", "prs", "actions", "devserver", "add", "dispatch"];
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({ ...ALL_TRUE, order: customOrder }));
    await store.load();
    expect(store.order).toEqual(customOrder);
  });

  it("save は現在の各フィールド値・orderをまとめてPUTする", async () => {
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({ status: "ok" }));
    store.branch = false;
    store.devserver = false;
    await store.save();
    expect(auth.apiFetch).toHaveBeenCalledWith("/settings/info-pills", {
      method: "PUT",
      body: { ...ALL_TRUE, branch: false, devserver: false, order: DEFAULT_ORDER },
    });
  });

  it("reorderは指定インデックスへ並べ替えてsaveする（useListDragSortのonReorder互換）", async () => {
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({ status: "ok" }));
    store.reorder(0, 1);
    expect(store.order).toEqual(["changes", "files", "branch", "prs", "actions", "devserver", "add", "dispatch"]);
    expect(auth.apiFetch).toHaveBeenCalledTimes(1);

    store.reorder(1, 0);
    expect(store.order).toEqual(DEFAULT_ORDER);
    expect(auth.apiFetch).toHaveBeenCalledTimes(2);
  });

  it("reorderは同じインデックスや範囲外では何もしない", () => {
    auth.apiFetch = vi.fn().mockResolvedValue(okRes({ status: "ok" }));
    store.reorder(0, 0);
    store.reorder(-1, 2);
    store.reorder(2, 99);
    expect(store.order).toEqual(DEFAULT_ORDER);
    expect(auth.apiFetch).not.toHaveBeenCalled();
  });
});
