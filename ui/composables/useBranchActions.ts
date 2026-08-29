import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useConfirm } from "./useConfirm.ts";
import { confirmIrreversible } from "../utils/confirm-irreversible.ts";
import { useToast } from "./useToast.ts";
import { useGitRemoteAction } from "./useGitRemoteAction.ts";
import { useWorktreeRemove } from "./useWorktreeRemove.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useWorktreeCleanup } from "./useWorktreeCleanup.ts";
import { worktreeBranchLabel, worktreeConfirmLabel, removeWorktreeConfirmMessage, worktreeWorkspaceName } from "../utils/worktree.ts";
import { emit } from "../app-bridge.ts";
import type { useBranchList } from "./useBranchList.ts";

// useToast は未型付けのため、利用するメソッドの型をここで明示する。
type ToastFn = (message: string, opts?: { duration?: number, action?: string | object }) => void;

type BranchEntry = { name: string, current?: boolean, remote?: boolean };
type WorktreeEntry = { worktree_branch?: string, branch?: string, name?: string, path?: string, workspace?: string };

export function useBranchActions(branchList: ReturnType<typeof useBranchList>) {
  const { apiCommand, wsEndpoint } = useApi();
  const { removeWorktreeRequest } = useWorktreeRemove();
  const { withWorkspace } = useWorkspace();
  const { confirm } = useConfirm();
  const toast: Record<"success" | "error" | "info" | "warning", ToastFn> = useToast();
  const { gitAction, isRunning } = useGitRemoteAction();
  const workspaceStore = useWorkspaceStore();
  const { findResidue, cleanupResidue } = useWorktreeCleanup();

  const { loadBranchList, loadWorktrees, loadRemoteBranches, remoteLoaded, invalidateRemoteCache } = branchList;

  const isFetchingRemote = ref(false);

  async function createBranch(name: string) {
    await withWorkspace(async (workspace) => {
      const { ok } = await apiCommand(wsEndpoint(workspace, "create-branch"), { branch: name });
      if (!ok) return;
      await loadBranchList();
      // create-branchは内部でcheckoutも行うため、折り畳みヘッダー（現在
      // ブランチ名・ahead/behind）の表示元であるworkspaceStoreも更新する。
      // git:commitDone購読側（GitHistory.vueのunpushed表示）がaheadの
      // 更新前に再読み込みしてしまわないよう、emit前にawaitする。
      await workspaceStore.fetchStatuses();
      emit("git:commitDone");
    });
  }

  async function createWorktree(branchName: string) {
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

  async function removeWorktree(wt: WorktreeEntry) {
    await withWorkspace(async (workspace) => {
      // wt（/worktrees API由来）はconfig.jsonに明示登録されたworktreeでしか
      // workspace/nameが埋まらないため、通常はここで base+branch から
      // "base:branch" 形式を組み立てて補う（findResidueが
      // wt.workspace||wt.name を見るだけだと常に空でタブが見つからなかった）。
      const wsName = wt.workspace || wt.name || worktreeWorkspaceName(workspace, wt.branch);
      const residue = await findResidue(wt, wsName);
      if (!await confirm(removeWorktreeConfirmMessage(wt, {
        openTabs: residue.openTabs.length,
        detachedSessions: residue.detachedSessions.length,
        devServers: residue.devServers.length,
      }))) return;
      if (!await removeWorktreeRequest(workspace, wt)) return;
      await cleanupResidue(residue);
      await workspaceStore.fetchWorkspaces();
      await loadWorktrees();
      toast.success(`Worktree removed: ${workspace}:${worktreeConfirmLabel(wt)}`);
    });
  }

  async function pushBranch(branch: BranchEntry) {
    await withWorkspace(async (workspace) => {
      await gitAction(workspace, "push-branch", { branch: branch.name });
      await loadBranchList();
      emit("git:commitDone");
    });
  }

  function isPushing(branch: BranchEntry) {
    return isRunning(workspaceStore.selectedWorkspace, "push-branch", branch.name);
  }

  async function pullBranch(branch: BranchEntry) {
    if (!branch.current) {
      toast.info(`Switch to "${branch.name}" to pull`);
      return;
    }
    await withWorkspace(async (workspace) => {
      await gitAction(workspace, "pull");
      await loadBranchList();
      emit("git:commitDone");
    });
  }

  async function deleteBranch(branch: BranchEntry) {
    await withWorkspace(async (workspace) => {
      const label = branch.remote ? "remote branch" : "branch";
      if (!await confirmIrreversible(confirm, `Delete ${label} "${branch.name}"?`)) return;
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
        toast.success("Fetched remote");
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
