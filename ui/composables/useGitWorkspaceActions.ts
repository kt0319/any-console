import { emit } from "../app-bridge.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { invalidateStashCache } from "./useStashCache.ts";
import { useApi } from "./useApi.ts";
import { useToast } from "./useToast.ts";

/**
 * ワークスペース単位の git ミューテーション（checkout / stash save）。
 * 呼び出し側が await して自分の loading 状態を閉じられるよう、成否を返す。
 */
export function useGitWorkspaceActions() {
  const { apiCommand, wsEndpoint } = useApi();
  const toast = useToast();
  const workspaceStore = useWorkspaceStore();

  async function checkoutBranch(workspace: string, branch: string, remote?: boolean): Promise<boolean> {
    const { ok } = await apiCommand(wsEndpoint(workspace, "checkout"), { branch, remote }, { errorMessage: "Checkout failed" });
    if (!ok) return false;
    workspaceStore.fetchStatuses();
    toast.success(`Switched branch to "${branch}"`);
    return true;
  }

  async function stashSave(workspace: string): Promise<boolean> {
    const { ok, data } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true }, { errorMessage: "Stash save failed" });
    if (!ok) return false;
    invalidateStashCache(workspace);
    toast.success(data?.stdout?.trim() || "Stash saved");
    emit("git:commitDone");
    return true;
  }

  return { checkoutBranch, stashSave };
}
