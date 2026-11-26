import { useConfirm } from "./useConfirm.ts";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useWorktreeRemoveConfirm } from "./useWorktreeRemoveConfirm.ts";
import { emit } from "../app-bridge.ts";
import { baseWorkspaceName } from "../utils/worktree.ts";
import { confirmCloseTab } from "../utils/tab-close-confirm.ts";

/**
 * タブ閉じ確認ダイアログと結果（close / "detach" / "worktree"）のディスパッチ共通フロー。
 * 呼び出し側ごとに分岐をコピーすると選択肢追加時に取りこぼす（サイドバーで Detach が無視された回帰）。
 * close のフォロー処理は onClose で差し替え可（省略時 tab:close を emit）。
 */
function findWorktreeOfTab(tab: TerminalTab) {
  if (!tab.workspace || baseWorkspaceName(tab.workspace) === tab.workspace) return null;
  return useWorkspaceStore().allWorkspaces.find((ws) => ws.name === tab.workspace && ws.worktree && ws.worktree_base) ?? null;
}

export function useTabClose() {
  const { confirm } = useConfirm();
  const terminalStore = useTerminalStore();

  async function confirmAndCloseTab(
    tab: TerminalTab,
    onClose: (tab: TerminalTab) => void | Promise<void> = (t) => emit("tab:close", { tab: t }),
  ) {
    let worktree = findWorktreeOfTab(tab);
    if (!worktree && tab.workspace && baseWorkspaceName(tab.workspace) !== tab.workspace) {
      await useWorkspaceStore().fetchWorkspaces();
      worktree = findWorktreeOfTab(tab);
    }
    const result = await confirmCloseTab(confirm, tab, !!worktree);
    if (result === true) await onClose(tab);
    else if (result === "detach") terminalStore.detachTab(tab.id);
    else if (result === "worktree" && worktree) {
      await useWorktreeRemoveConfirm().confirmAndRemoveWorktree(worktree.worktree_base, worktree);
    }
  }

  return { confirmAndCloseTab };
}
