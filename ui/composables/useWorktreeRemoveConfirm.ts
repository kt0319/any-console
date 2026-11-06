import { useConfirm } from "./useConfirm.ts";
import { useWorktreeCleanup } from "./useWorktreeCleanup.ts";
import { useWorktreeRemove } from "./useWorktreeRemove.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { removeWorktreeConfirmMessage } from "../utils/worktree.ts";

/**
 * worktree削除の確認ダイアログ付きフロー。ワークスペース一覧（WorkspaceOpen.vue）と
 * タブを閉じる確認（useTabClose.ts）の両方から使う。残骸（開いているタブ・
 * detachedセッション・dev server）の件数を確認文言に載せ、削除後に片付ける。
 */
export function useWorktreeRemoveConfirm() {
  const { confirm } = useConfirm();
  const { removeWorktreeRequest } = useWorktreeRemove();
  const { findResidue, cleanupResidue } = useWorktreeCleanup();
  const workspaceStore = useWorkspaceStore();

  async function confirmAndRemoveWorktree(baseName: string, wt: Record<string, any>) {
    const residue = await findResidue(wt);
    await confirm(removeWorktreeConfirmMessage(wt, {
      openTabs: residue.openTabs.length,
      detachedSessions: residue.detachedSessions.length,
      devServers: residue.devServers.length,
    }), {
      busyLabel: "Removing...",
      run: async () => {
        if (!await removeWorktreeRequest(baseName, wt)) return;
        await cleanupResidue(residue);
        await workspaceStore.fetchWorkspaces();
      },
    });
  }

  return { confirmAndRemoveWorktree };
}
