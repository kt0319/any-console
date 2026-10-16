// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAuthStore } from "../../ui/stores/auth.ts";
import { useApi } from "../../ui/composables/useApi.ts";
import { on } from "../../ui/app-bridge.ts";

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

describe("apiWithPeek", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("成功時にgit:remoteDoneへkind noneの結果を流しonSuccessを呼ぶ", async () => {
    useAuthStore().apiFetch = vi.fn(async () => jsonResponse({ status: "ok" }));
    const events = [];
    const off = on("git:remoteDone", (d) => events.push(d));
    const onSuccess = vi.fn();

    const ok = await useApi().apiWithPeek("/workspaces/ws1/merge", { branch: "dev" }, {
      wsName: "ws1", headline: "Merged", detail: "dev", errorMessage: "Merge failed", onSuccess,
    });

    expect(ok).toBe(true);
    expect(events).toEqual([{ wsName: "ws1", result: { kind: "none", headline: "Merged", detail: "dev" } }]);
    expect(onSuccess).toHaveBeenCalled();
    off();
  });

  it("失敗時はイベントを流さずfalseを返す", async () => {
    useAuthStore().apiFetch = vi.fn(async () => jsonResponse({ detail: "boom" }, false));
    const events = [];
    const off = on("git:remoteDone", (d) => events.push(d));

    const ok = await useApi().apiWithPeek("/workspaces/ws1/merge", {}, {
      wsName: "ws1", headline: "Merged", errorMessage: "Merge failed",
    });

    expect(ok).toBe(false);
    expect(events).toEqual([]);
    off();
  });
});
