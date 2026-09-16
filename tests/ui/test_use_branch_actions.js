// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useWorkspaceStore } from "../../ui/stores/workspace.ts";

const gitActionMock = vi.fn(async () => ({ ok: true, data: {} }));

vi.mock("../../ui/composables/useGitRemoteAction.ts", () => ({
  useGitRemoteAction: () => ({
    gitAction: gitActionMock,
    isRunning: vi.fn(() => false),
  }),
}));

vi.mock("../../ui/composables/useToast.ts", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const apiCommandMock = vi.fn(async () => ({ ok: true, data: {} }));
vi.mock("../../ui/composables/useApi.ts", () => ({
  useApi: () => ({
    apiCommand: apiCommandMock,
    wsEndpoint: (ws, action) => `/workspaces/${ws}/${action}`,
  }),
}));

// confirm の戻り値（削除確認ダイアログでの選択）をテストごとに切り替える。
let confirmResult = /** @type {boolean | string} */ (true);
vi.mock("../../ui/composables/useConfirm.ts", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => confirmResult) }),
}));

const findResidueMock = vi.fn(async () => ({ openTabs: [], detachedSessions: [], devServers: [] }));
const cleanupResidueMock = vi.fn(async () => {});
vi.mock("../../ui/composables/useWorktreeCleanup.ts", () => ({
  useWorktreeCleanup: () => ({
    findResidue: findResidueMock,
    cleanupResidue: cleanupResidueMock,
  }),
}));

const removeWorktreeRequestMock = vi.fn(async () => true);
vi.mock("../../ui/composables/useWorktreeRemove.ts", () => ({
  useWorktreeRemove: () => ({ removeWorktreeRequest: removeWorktreeRequestMock }),
}));

// vi.resetModules()するとapp-bridge.tsも再読み込みされ、on/emitが別々の
// モジュールインスタンス（別々のリスナーレジストリ）を参照してイベントが
// 届かなくなる。on・useBranchActionsの両方をresetModules後に同じタイミングで
// 動的importし、同一インスタンスを共有させる。
async function freshModule() {
  vi.resetModules();
  const [{ useBranchActions }, { on }] = await Promise.all([
    import("../../ui/composables/useBranchActions.ts"),
    import("../../ui/app-bridge.ts"),
  ]);
  return { useBranchActions, on };
}

function fakeBranchList(linkedWorktree = vi.fn(() => null)) {
  return {
    loadBranchList: vi.fn(async () => {}),
    loadWorktrees: vi.fn(async () => {}),
    loadRemoteBranches: vi.fn(async () => {}),
    remoteLoaded: { value: false },
    invalidateRemoteCache: vi.fn(),
    linkedWorktree,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  gitActionMock.mockClear();
  apiCommandMock.mockClear();
  findResidueMock.mockClear();
  cleanupResidueMock.mockClear();
  removeWorktreeRequestMock.mockClear();
  confirmResult = true;
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

describe("useBranchActions: deleteLocalBranch（削除確認ダイアログの選択肢ごとの分岐）", () => {
  it('"Local only"（true）はremote:falseで1回だけ削除APIを呼ぶ', async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";
    confirmResult = true;

    const { useBranchActions, on } = await freshModule();
    const { deleteLocalBranch } = useBranchActions(fakeBranchList());
    const handler = vi.fn();
    const off = on("git:commitDone", handler);
    await deleteLocalBranch({ name: "feature/x" });
    off();

    const deleteCalls = apiCommandMock.mock.calls.filter((c) => c[0] === "/workspaces/repo/delete-branch");
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]).toEqual([
      "/workspaces/repo/delete-branch",
      { branch: "feature/x", remote: false },
      expect.objectContaining({ errorMessage: expect.any(String) }),
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('"Local + remote"（"remote"）はローカル削除に続けてリモート削除も呼ぶ', async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";
    confirmResult = "remote";

    const { useBranchActions } = await freshModule();
    const { deleteLocalBranch } = useBranchActions(fakeBranchList());
    await deleteLocalBranch({ name: "feature/x" });

    const deleteCalls = apiCommandMock.mock.calls.filter((c) => c[0] === "/workspaces/repo/delete-branch");
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0][1]).toEqual({ branch: "feature/x", remote: false });
    expect(deleteCalls[1][1]).toEqual({ branch: "feature/x", remote: true });
  });

  it("キャンセル（false）は削除APIを呼ばない", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";
    confirmResult = false;

    const { useBranchActions } = await freshModule();
    const { deleteLocalBranch } = useBranchActions(fakeBranchList());
    await deleteLocalBranch({ name: "feature/x" });

    expect(apiCommandMock).not.toHaveBeenCalled();
  });

  it('worktreeが紐づく場合、"worktree"選択で削除APIではなくremoveWorktreeRequestを呼ぶ', async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";
    confirmResult = "worktree";
    const wt = { branch: "feature/x", path: "/tmp/wt" };

    const { useBranchActions } = await freshModule();
    const { deleteLocalBranch } = useBranchActions(fakeBranchList(vi.fn(() => wt)));
    await deleteLocalBranch({ name: "feature/x" });

    expect(findResidueMock).toHaveBeenCalledTimes(1);
    expect(removeWorktreeRequestMock).toHaveBeenCalledWith("repo", wt);
    expect(cleanupResidueMock).toHaveBeenCalledTimes(1);
    expect(apiCommandMock).not.toHaveBeenCalled();
  });

  it("ローカル削除自体が失敗した場合はremote選択でもリモート削除を呼ばない", async () => {
    const workspaceStore = useWorkspaceStore();
    workspaceStore.selectedWorkspace = "repo";
    confirmResult = "remote";
    apiCommandMock.mockResolvedValueOnce({ ok: false, data: null });

    const { useBranchActions } = await freshModule();
    const { deleteLocalBranch } = useBranchActions(fakeBranchList());
    await deleteLocalBranch({ name: "feature/x" });

    expect(apiCommandMock).toHaveBeenCalledTimes(1);
  });
});
