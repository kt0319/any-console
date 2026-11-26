import { useApi } from "./useApi.ts";
import { emit } from "../app-bridge.ts";
import { buildActionResult } from "../utils/git-remote.ts";
import { worktreeConfirmLabel } from "../utils/worktree.ts";

// worktree 削除のAPI呼び出し。SessionOpenHome.vue と useBranchActions.ts で共通のリクエスト部分のみ（確認ダイアログ・削除後の更新は呼び出し側）。
// 成功はベースワークスペースのbranch peekに出す。
export function useWorktreeRemove() {
  const { apiDelete, wsEndpoint } = useApi();

  async function removeWorktreeRequest(workspace: string, wt: { path?: string, worktree_branch?: string, branch?: string, name?: string }): Promise<boolean> {
    const { ok } = await apiDelete(wsEndpoint(workspace, "worktrees"), {
      body: { path: wt.path },
      checkStatus: true,
      errorMessage: "Failed to remove worktree",
    });
    if (ok) emit("git:actionResult", { wsName: workspace, result: buildActionResult("Worktree removed", worktreeConfirmLabel(wt)) });
    return ok;
  }

  return { removeWorktreeRequest };
}
