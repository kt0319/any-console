// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWorkspaceStore } from "../../ui/stores/workspace.js";

const gitActionMock = vi.fn(async () => ({ ok: true, data: {} }));

vi.mock("../../ui/composables/useGitRemoteAction.js", () => ({
  useGitRemoteAction: () => ({
    gitAction: gitActionMock,
    isRunning: vi.fn(() => false),
  }),
}));

vi.mock("../../ui/composables/useToast.js", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// vi.resetModules()するとapp-bridge.jsも再読み込みされ、on/emitが別々の
// モジュールインスタンス（別々のリスナーレジストリ）を参照してイベントが
// 届かなくなる。on・useBranchActionsの両方をresetModules後に同じタイミングで
// 動的importし、同一インスタンスを共有させる。
async function freshModule() {
  vi.resetModules();
  const [{ useBranchActions }, { on }] = await Promise.all([
    import("../../ui/composables/useBranchActions.js"),
    import("../../ui/app-bridge.js"),
  ]);
  return { useBranchActions, on };
}

function fakeBranchList() {
  return {
    loadBranchList: vi.fn(async () => {}),
    loadWorktrees: vi.fn(async () => {}),
    loadRemoteBranches: vi.fn(async () => {}),
    remoteLoaded: { value: false },
    invalidateRemoteCache: vi.fn(),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  gitActionMock.mockClear();
});

describe("useBranchActions: push/pull後にHistoryが更新されること", () => {
  it("pushBranchはgit:commitDoneを発火する", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";

    const { useBranchActions, on } = await freshModule();
    const { pushBranch } = useBranchActions(fakeBranchList());

    const handler = vi.fn();
    const off = on("git:commitDone", handler);
    await pushBranch({ name: "feature/x" });
    off();

    expect(gitActionMock).toHaveBeenCalledWith("repo", "push-branch", { branch: "feature/x" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("pullBranchはgit:commitDoneを発火する（currentブランチのみ）", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";

    const { useBranchActions, on } = await freshModule();
    const { pullBranch } = useBranchActions(fakeBranchList());

    const handler = vi.fn();
    const off = on("git:commitDone", handler);
    await pullBranch({ name: "main", current: true });
    off();

    expect(gitActionMock).toHaveBeenCalledWith("repo", "pull");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("pullBranchはcurrentでないブランチではgitActionを呼ばずgit:commitDoneも発火しない", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";

    const { useBranchActions, on } = await freshModule();
    const { pullBranch } = useBranchActions(fakeBranchList());

    const handler = vi.fn();
    const off = on("git:commitDone", handler);
    await pullBranch({ name: "other-branch", current: false });
    off();

    expect(gitActionMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
