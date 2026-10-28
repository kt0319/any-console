import { emit } from "../app-bridge.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { invalidateStashCache } from "./useStashCache.ts";
import { useApi } from "./useApi.ts";
import { buildActionResult } from "../utils/git-remote.ts";

/**
 * ワークスペース単位の git ミューテーション（checkout / stash save / コンフリクト解消の中止・解消済み化）。
 * 呼び出し側が await して自分の loading 状態を閉じられるよう、成否を返す。
 */
export function useGitWorkspaceActions() {
  const { apiCommand, wsEndpoint } = useApi();
  const workspaceStore = useWorkspaceStore();

  async function checkoutBranch(workspace: string, branch: string, remote?: boolean): Promise<boolean> {
    const { ok } = await apiCommand(wsEndpoint(workspace, "checkout"), { branch, remote }, { errorMessage: "Checkout failed" });
    if (!ok) return false;
    workspaceStore.fetchStatuses();
    return true;
  }

  async function stashSave(workspace: string): Promise<boolean> {
    const { ok, data } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true }, { errorMessage: "Stash save failed" });
    if (!ok) return false;
    invalidateStashCache(workspace);
    emit("git:remoteDone", { wsName: workspace, result: buildActionResult("Stash saved", data?.stdout?.trim() || "") });
    emit("git:commitDone");
    return true;
  }

  // コンフリクト解消の中止（merge / rebase / cherry-pick / revert のうち進行中のもの）
  async function abortOperation(workspace: string, operation: string): Promise<boolean> {
    const { ok } = await apiCommand(wsEndpoint(workspace, "abort-operation"), {}, { errorMessage: `Abort ${operation} failed` });
    if (!ok) return false;
    workspaceStore.fetchStatuses();
    emit("git:remoteDone", { wsName: workspace, result: buildActionResult(`Aborted ${operation}`, "") });
    emit("git:commitDone");
    return true;
  }

  async function markResolved(workspace: string, path: string): Promise<boolean> {
    const { ok } = await apiCommand(wsEndpoint(workspace, "mark-resolved"), { path }, { errorMessage: "Mark resolved failed" });
    if (!ok) return false;
    workspaceStore.fetchStatuses();
    emit("git:remoteDone", { wsName: workspace, result: buildActionResult("Marked resolved", path) });
    emit("git:commitDone");
    return true;
  }

  return { checkoutBranch, stashSave, abortOperation, markResolved };
}
