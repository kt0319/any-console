import { useConfirm } from "./useConfirm.ts";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useWorktreeRemoveConfirm } from "./useWorktreeRemoveConfirm.ts";
import { emit } from "../app-bridge.ts";
import { baseWorkspaceName } from "../utils/worktree.ts";
import { confirmCloseTab } from "../utils/tab-close-confirm.ts";

/**
 * タブ閉じ確認ダイアログと、その結果（close / "detach" / "worktree"）の
 * ディスパッチをまとめた共通フロー。
 *
 * 結果分岐を呼び出し側ごとにコピーすると、ダイアログの選択肢が増えた時に
 * 取りこぼす（サイドバーの閉じるボタンで Detach の選択が黙って
 * 無視されていた回帰の再発防止）。close だけは呼び出し元でフォロー処理が
 * 異なるため `onClose` で差し替えられる（省略時は `tab:close` を emit）。
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
    const worktree = findWorktreeOfTab(tab);
    const result = await confirmCloseTab(confirm, tab, !!worktree);
    if (result === true) await onClose(tab);
    else if (result === "detach") terminalStore.detachTab(tab.id);
    else if (result === "worktree" && worktree) {
      await useWorktreeRemoveConfirm().confirmAndRemoveWorktree(worktree.worktree_base, worktree);
    }
  }

  return { confirmAndCloseTab };
}
