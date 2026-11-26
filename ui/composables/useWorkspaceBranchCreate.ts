import { useApi } from "./useApi.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { emit } from "../app-bridge.ts";
import { buildActionResult } from "../utils/git-remote.ts";
import { worktreeBranchLabel } from "../utils/worktree.ts";

/** 指定ワークスペースでのブランチ / worktree 作成。成功したかどうかを返す。 */
export function useWorkspaceBranchCreate() {
  const { apiCommand, wsEndpoint } = useApi();
  const workspaceStore = useWorkspaceStore();

  async function createBranchIn(workspace: string, name: string): Promise<boolean> {
    const { ok } = await apiCommand(wsEndpoint(workspace, "create-branch"), { branch: name });
    if (!ok) return false;
    // create-branch は checkout も行うため workspaceStore も更新する。
    // git:historyInvalidated 購読側が ahead 更新前に再読み込みしないよう、emit 前に await する。
    await workspaceStore.fetchStatuses();
    emit("git:historyInvalidated");
    return true;
  }

  async function createWorktreeIn(workspace: string, branchName: string): Promise<boolean> {
    const { ok, data } = await apiCommand(
      wsEndpoint(workspace, "worktrees"),
      { branch: branchName },
      { errorMessage: "Failed to create worktree" },
    );
    if (!ok) return false;
    const created = data?.workspace;
    await workspaceStore.fetchWorkspaces();
    if (created?.name) {
      emit("git:actionResult", { wsName: workspace, result: buildActionResult("Worktree created", worktreeBranchLabel(created.branch)) });
      emit("worktree:open", { name: created.name });
    }
    return true;
  }

  return { createBranchIn, createWorktreeIn };
}
