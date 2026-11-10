// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";

const emitMock = vi.fn();
vi.mock("../../ui/app-bridge.ts", () => ({
  emit: (...args) => emitMock(...args),
  on: vi.fn(() => () => {}),
}));

const detachTabMock = vi.fn();
vi.mock("../../ui/stores/terminal.ts", () => ({
  useTerminalStore: () => ({ detachTab: detachTabMock }),
}));

const confirmAndRemoveWorktreeMock = vi.fn();
vi.mock("../../ui/composables/useWorktreeRemoveConfirm.ts", () => ({
  useWorktreeRemoveConfirm: () => ({ confirmAndRemoveWorktree: confirmAndRemoveWorktreeMock }),
}));

const worktreeEntry = { name: "ws1:feat", worktree: true, worktree_base: "ws1", worktree_branch: "feat" };
const lateWorktreeEntry = { name: "ws1:late", worktree: true, worktree_base: "ws1", worktree_branch: "late" };
const workspaces = [{ name: "ws1" }, worktreeEntry];
const fetchWorkspacesMock = vi.fn(async () => { workspaces.push(lateWorktreeEntry); });
vi.mock("../../ui/stores/workspace.ts", () => ({
  useWorkspaceStore: () => ({ allWorkspaces: workspaces, fetchWorkspaces: fetchWorkspacesMock }),
}));

// confirm の戻り値（ダイアログでの選択）をテストごとに切り替える。
let confirmResult = /** @type {boolean | string} */ (true);
vi.mock("../../ui/composables/useConfirm.ts", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => confirmResult) }),
}));

const tab = { id: 7, workspace: "ws1", label: "ws1" };

async function freshModule() {
  vi.resetModules();
  return import("../../ui/composables/useTabClose.ts");
}

beforeEach(() => {
  emitMock.mockClear();
  detachTabMock.mockClear();
  confirmResult = true;
  confirmAndRemoveWorktreeMock.mockClear();
});

describe("useTabClose: 確認結果のディスパッチ", () => {
  it("Close 確定（true）は既定で tab:close を emit する", async () => {
    const { useTabClose } = await freshModule();
    await useTabClose().confirmAndCloseTab(tab);
    expect(emitMock).toHaveBeenCalledWith("tab:close", { tab });
    expect(detachTabMock).not.toHaveBeenCalled();
  });

  it("Close 確定（true）で onClose 指定時はそちらだけを呼ぶ", async () => {
    const { useTabClose } = await freshModule();
    const onClose = vi.fn();
    await useTabClose().confirmAndCloseTab(tab, onClose);
    expect(onClose).toHaveBeenCalledWith(tab);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('Detach 選択（"detach"）は terminalStore.detachTab を呼ぶ', async () => {
    confirmResult = "detach";
    const { useTabClose } = await freshModule();
    await useTabClose().confirmAndCloseTab(tab);
    expect(detachTabMock).toHaveBeenCalledWith(tab.id);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("キャンセル（false）は何もしない", async () => {
    confirmResult = false;
    const { useTabClose } = await freshModule();
    const onClose = vi.fn();
    await useTabClose().confirmAndCloseTab(tab, onClose);
    expect(onClose).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
    expect(detachTabMock).not.toHaveBeenCalled();
  });

  it('worktree のタブで "worktree" 選択なら worktree 削除フローへ進み、タブ自体は直接閉じない', async () => {
    confirmResult = "worktree";
    const { useTabClose } = await freshModule();
    await useTabClose().confirmAndCloseTab({ id: 8, workspace: "ws1:feat", label: "ws1:feat" });
    expect(confirmAndRemoveWorktreeMock).toHaveBeenCalledWith("ws1", worktreeEntry);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("一覧にまだ無い worktree のタブは、一覧を取得し直して worktree 削除の選択肢を出す", async () => {
    confirmResult = "worktree";
    const { useTabClose } = await freshModule();
    await useTabClose().confirmAndCloseTab({ id: 9, workspace: "ws1:late", label: "ws1:late" });
    expect(fetchWorkspacesMock).toHaveBeenCalledTimes(1);
    expect(confirmAndRemoveWorktreeMock).toHaveBeenCalledWith("ws1", lateWorktreeEntry);
  });

  it("worktree でないタブでは worktree 削除フローに進まない", async () => {
    confirmResult = "worktree";
    const { useTabClose } = await freshModule();
    await useTabClose().confirmAndCloseTab(tab);
    expect(confirmAndRemoveWorktreeMock).not.toHaveBeenCalled();
  });
});
