// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWorkspaceStore } from "../../ui/stores/workspace.ts";

const apiCommandMock = vi.fn(async () => ({ ok: true, data: {} }));
const apiWithToastMock = vi.fn(async ({ onSuccess } = {}) => {});

vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({
    apiCommand: apiCommandMock,
    apiWithToast: apiWithToastMock,
    wsEndpoint: (ws, action) => `/workspaces/${ws}/${action}`,
  }),
}));

vi.mock("../../ui/composables/useConfirm.ts", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

vi.mock("../../ui/composables/useToast.ts", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useGitRemoteAction.ts");
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiCommandMock.mockClear();
  apiWithToastMock.mockClear();
});

describe("useGitRemoteAction: 実行中ロックの範囲", () => {
  it("ベースワークスペースとそのlinked worktreeは同じリポジトリとしてロックを共有する", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.allWorkspaces = [
      { name: "repo", worktree: false },
      { name: "repo [feature/x]", worktree: true, worktree_base: "repo" },
    ];
    let resolveApiCommand;
    apiCommandMock.mockReturnValue(new Promise((resolve) => { resolveApiCommand = resolve; }));

    const { useGitRemoteAction } = await freshModule();
    const { gitAction, isAnyRunning } = useGitRemoteAction();

    const p = gitAction("repo", "pull");
    await Promise.resolve();
    await Promise.resolve();

    // ベースがpull中なら、同じリポジトリを指すworktree名でも busy 扱いになる
    expect(isAnyRunning("repo [feature/x]")).toBe(true);

    // worktree側から別アクションを起動しようとしても、同じリポジトリなので実行されない
    await gitAction("repo [feature/x]", "push");
    expect(apiCommandMock).toHaveBeenCalledTimes(1);

    resolveApiCommand({ ok: true, data: {} });
    await p;
    expect(isAnyRunning("repo [feature/x]")).toBe(false);
  });

  it("無関係な別ワークスペースの操作はブロックされない", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.allWorkspaces = [
      { name: "repo-a", worktree: false },
      { name: "repo-b", worktree: false },
    ];
    let resolveApiCommand;
    apiCommandMock.mockReturnValue(new Promise((resolve) => { resolveApiCommand = resolve; }));

    const { useGitRemoteAction } = await freshModule();
    const { gitAction, isAnyRunning } = useGitRemoteAction();

    const p1 = gitAction("repo-a", "pull");
    await Promise.resolve();
    await Promise.resolve();

    expect(isAnyRunning("repo-a")).toBe(true);
    expect(isAnyRunning("repo-b")).toBe(false);

    const p2 = gitAction("repo-b", "pull");
    await Promise.resolve();
    await Promise.resolve();
    expect(apiCommandMock).toHaveBeenCalledTimes(2);

    resolveApiCommand({ ok: true, data: {} });
    await Promise.all([p1, p2]);
  });
});
