import { useApi } from "./useApi.ts";
import { emit } from "../app-bridge.ts";
import { buildActionResult } from "../utils/git-remote.ts";
import { worktreeConfirmLabel } from "../utils/worktree.ts";

// worktree 削除のAPI呼び出し。ワークスペース一覧（WorkspaceOpen.vue）と
// Branchesタブ（useBranchActions.ts）の両方から使うため、リクエスト部分だけ
// ここに共通化する（確認ダイアログや削除後のリフレッシュは画面ごとに異なる
// ので呼び出し側の責務のまま）。成功はベースワークスペースのbranch peekに出す。
export function useWorktreeRemove() {
  const { apiDelete, wsEndpoint } = useApi();

  /**
   * @param workspace ベースワークスペース名
   * @param wt 削除対象のworktree
   * @returns 削除に成功したか
   */
  async function removeWorktreeRequest(workspace: string, wt: { path?: string, worktree_branch?: string, branch?: string, name?: string }): Promise<boolean> {
    const { ok } = await apiDelete(wsEndpoint(workspace, "worktrees"), {
      body: { path: wt.path },
      checkStatus: true,
      errorMessage: "Failed to remove worktree",
    });
    if (ok) emit("git:remoteDone", { wsName: workspace, result: buildActionResult("Worktree removed", worktreeConfirmLabel(wt)) });
    return ok;
  }

  return { removeWorktreeRequest };
}
