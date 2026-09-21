// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWorkspaceStore } from "../../ui/stores/workspace.ts";

const toastSuccess = vi.fn();
vi.mock("../../ui/composables/useToast.ts", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn() }),
}));

let apiResult = /** @type {{ ok: boolean, data?: any }} */ ({ ok: true, data: {} });
const apiCommandMock = vi.fn(async () => apiResult);
vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({
    apiCommand: apiCommandMock,
    wsEndpoint: (ws, action) => `/workspaces/${ws}/${action}`,
  }),
}));

async function freshModule() {
  vi.resetModules();
  // resetModules 後は app-bridge / stash cache も別インスタンスになるため、
  // 検証対象と同じタイミングで動的 import して同一インスタンスを共有する。
  const [{ useGitWorkspaceActions }, { on }, stashCache] = await Promise.all([
    import("../../ui/composables/useGitWorkspaceActions.ts"),
    import("../../ui/app-bridge.ts"),
    import("../../ui/composables/useStashCache.ts"),
  ]);
  return { useGitWorkspaceActions, on, ...stashCache };
}

describe("useGitWorkspaceActions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiResult = { ok: true, data: {} };
    apiCommandMock.mockClear();
    toastSuccess.mockClear();
  });

  it("checkoutBranch は成功時に statuses を再取得して true を返す", async () => {
    const { useGitWorkspaceActions } = await freshModule();
    const store = useWorkspaceStore();
    store.fetchStatuses = vi.fn(async () => {});
    const { checkoutBranch } = useGitWorkspaceActions();

    expect(await checkoutBranch("ws1", "feature", true)).toBe(true);
    expect(apiCommandMock).toHaveBeenCalledWith(
      "/workspaces/ws1/checkout",
      { branch: "feature", remote: true },
      expect.objectContaining({ errorMessage: "Checkout failed" }),
    );
    expect(store.fetchStatuses).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Switched branch to "feature"');
  });

  it("checkoutBranch は失敗時に false を返し副作用を起こさない", async () => {
    apiResult = { ok: false };
    const { useGitWorkspaceActions } = await freshModule();
    const store = useWorkspaceStore();
    store.fetchStatuses = vi.fn(async () => {});
    const { checkoutBranch } = useGitWorkspaceActions();

    expect(await checkoutBranch("ws1", "feature")).toBe(false);
    expect(store.fetchStatuses).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("stashSave は成功時に stash キャッシュを無効化し git:commitDone を発火する", async () => {
    apiResult = { ok: true, data: { stdout: "Saved working directory\n" } };
    const { useGitWorkspaceActions, on, setStashCache, getStashCachedCount } = await freshModule();
    const events = [];
    const off = on("git:commitDone", () => events.push("commitDone"));
    setStashCache("ws1", [{ ref: "stash@{0}", message: "x" }]);
    const { stashSave } = useGitWorkspaceActions();

    expect(await stashSave("ws1")).toBe(true);
    expect(apiCommandMock).toHaveBeenCalledWith(
      "/workspaces/ws1/stash",
      { include_untracked: true },
      expect.objectContaining({ errorMessage: "Stash save failed" }),
    );
    expect(getStashCachedCount("ws1")).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith("Saved working directory");
    expect(events).toEqual(["commitDone"]);
    off();
  });

  it("stashSave は失敗時に false を返しキャッシュを保持する", async () => {
    apiResult = { ok: false };
    const { useGitWorkspaceActions, setStashCache, getStashCachedCount } = await freshModule();
    setStashCache("ws1", [{ ref: "stash@{0}", message: "x" }]);
    const { stashSave } = useGitWorkspaceActions();

    expect(await stashSave("ws1")).toBe(false);
    expect(getStashCachedCount("ws1")).toBe(1);
  });
});
