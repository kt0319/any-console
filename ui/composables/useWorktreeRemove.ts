import { useApi } from "./useApi.ts";

// worktree 削除のAPI呼び出し。ワークスペース一覧（WorkspaceOpen.vue）と
// Branchesタブ（useBranchActions.ts）の両方から使うため、リクエスト部分だけ
// ここに共通化する（確認ダイアログや削除後のリフレッシュは画面ごとに異なる
// ので呼び出し側の責務のまま）。
export function useWorktreeRemove() {
  const { apiDelete, wsEndpoint } = useApi();

  /**
   * @param workspace ベースワークスペース名
   * @param wt 削除対象のworktree
   * @returns 削除に成功したか
   */
  async function removeWorktreeRequest(workspace: string, wt: { path?: string }): Promise<boolean> {
    const { ok } = await apiDelete(wsEndpoint(workspace, "worktrees"), {
      body: { path: wt.path },
      checkStatus: true,
      errorMessage: "Failed to remove worktree",
    });
    return ok;
  }

  return { removeWorktreeRequest };
}
