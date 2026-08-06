import { ref } from "vue";
import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { useConfirm } from "./useConfirm.js";
import { useToast } from "./useToast.js";
import { useGitRemoteAction } from "./useGitRemoteAction.js";
import { useWorktreeRemove } from "./useWorktreeRemove.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { worktreeBranchLabel, worktreeConfirmLabel, removeWorktreeConfirmMessage } from "../utils/worktree.js";
import { emit } from "../app-bridge.js";

export function useBranchActions(branchList) {
  const { apiCommand, wsEndpoint } = useApi();
  const { removeWorktreeRequest } = useWorktreeRemove();
  const { withWorkspace } = useWorkspace();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { gitAction, isRunning } = useGitRemoteAction();
  const workspaceStore = useWorkspaceStore();

  const { loadBranchList, loadWorktrees, loadRemoteBranches, remoteLoaded, invalidateRemoteCache } = branchList;

  const isFetchingRemote = ref(false);

  async function createBranch(name) {
    await withWorkspace(async (workspace) => {
      const { ok } = await apiCommand(wsEndpoint(workspace, "create-branch"), { branch: name });
      if (!ok) return;
      await loadBranchList();
      // create-branchは内部でcheckoutも行うため、折り畳みヘッダー（現在
      // ブランチ名・ahead/behind）の表示元であるworkspaceStoreも更新する。
      workspaceStore.fetchStatuses();
      emit("git:commitDone");
    });
  }

  async function createWorktree(branchName) {
    await withWorkspace(async (workspace) => {
      const { ok, data } = await apiCommand(
        wsEndpoint(workspace, "worktrees"),
        { branch: branchName },
        { errorMessage: "Failed to create worktree" },
      );
      if (!ok) return;
      const created = data?.workspace;
      await workspaceStore.fetchWorkspaces();
      await loadBranchList();
      if (created?.name) {
        toast.success(`Worktree ${worktreeBranchLabel(created.branch)} created`);
        emit("worktree:open", { name: created.name, pane: "jobs" });
      }
    });
  }

  async function removeWorktree(wt) {
    await withWorkspace(async (workspace) => {
      if (!await confirm(removeWorktreeConfirmMessage(wt))) return;
      if (!await removeWorktreeRequest(workspace, wt)) return;
      await workspaceStore.fetchWorkspaces();
      await loadWorktrees();
      toast.success(`Worktree removed: ${workspace} [${worktreeConfirmLabel(wt)}]`);
    });
  }

  async function pushBranch(branch) {
    await withWorkspace(async (workspace) => {
      await gitAction(workspace, "push-branch", { branch: branch.name });
      await loadBranchList();
    });
  }

  function isPushing(branch) {
    return isRunning(workspaceStore.selectedWorkspace, "push-branch", branch.name);
  }

  async function pullBranch(branch) {
    if (!branch.current) {
      emit("toast:show", { message: `Switch to "${branch.name}" to pull`, type: "info" });
      return;
    }
    await withWorkspace(async (workspace) => {
      await gitAction(workspace, "pull");
      await loadBranchList();
    });
  }

  async function deleteBranch(branch) {
    await withWorkspace(async (workspace) => {
      const label = branch.remote ? `Remote branch ${branch.name}` : `Branch ${branch.name}`;
      if (!await confirm(`Delete ${label}?`)) return;
      const { ok } = await apiCommand(wsEndpoint(workspace, "delete-branch"), { branch: branch.name, remote: branch.remote });
      if (!ok) return;
      if (branch.remote) invalidateRemoteCache(workspace);
      await loadBranchList();
      emit("git:commitDone");
      await fetchRemote();
    });
  }

  async function backgroundFetch() {
    await withWorkspace(async (workspace) => {
      try {
        await apiCommand(wsEndpoint(workspace, "fetch"));
      } catch (e) {
        console.error("background fetch failed:", e);
      }
    });
  }

  async function fetchRemote() {
    if (isFetchingRemote.value) return;
    isFetchingRemote.value = true;
    try {
      await withWorkspace(async (workspace) => {
        const { ok } = await apiCommand(wsEndpoint(workspace, "fetch"), {}, {
          errorMessage: "Fetch failed",
        });
        if (!ok) return;
        remoteLoaded.value = false;
        await loadBranchList();
        await loadRemoteBranches();
        emit("toast:show", { message: "Fetched remote", type: "success" });
      });
    } finally {
      isFetchingRemote.value = false;
    }
  }

  return {
    isFetchingRemote,
    isRunning,
    isPushing,
    createBranch,
    createWorktree,
    removeWorktree,
    pushBranch,
    pullBranch,
    deleteBranch,
    backgroundFetch,
    fetchRemote,
  };
}
