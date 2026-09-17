import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useConfirm } from "./useConfirm.ts";
import { confirmIrreversible } from "../utils/confirm-irreversible.ts";
import { confirmDeleteBranch } from "../utils/branch-delete-confirm.ts";
import { useToast } from "./useToast.ts";
import { useGitRemoteAction } from "./useGitRemoteAction.ts";
import { useWorktreeRemove } from "./useWorktreeRemove.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useWorktreeCleanup } from "./useWorktreeCleanup.ts";
import { worktreeBranchLabel, worktreeConfirmLabel, worktreeResidueNote, worktreeWorkspaceName } from "../utils/worktree.ts";
import { emit } from "../app-bridge.ts";
import type { useBranchList } from "./useBranchList.ts";

type BranchEntry = { name: string, current?: boolean, remote?: boolean };
type WorktreeEntry = { worktree_branch?: string, branch?: string, name?: string, path?: string, workspace?: string };

export function useBranchActions(branchList: ReturnType<typeof useBranchList>) {
  const { apiCommand, wsEndpoint } = useApi();
  const { removeWorktreeRequest } = useWorktreeRemove();
  const { withWorkspace } = useWorkspace();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { gitAction, isRunning } = useGitRemoteAction();
  const workspaceStore = useWorkspaceStore();
  const { findResidue, cleanupResidue } = useWorktreeCleanup();

  const { loadBranchList, loadWorktrees, loadRemoteBranches, remoteLoaded, invalidateRemoteCache, linkedWorktree } = branchList;

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

  type Residue = { openTabs: any[], detachedSessions: any[], devServers: any[] };

  async function removeWorktreeNow(workspace: string, wt: WorktreeEntry, residue: Residue) {
    if (!await removeWorktreeRequest(workspace, wt)) return;
    await cleanupResidue(residue);
    await workspaceStore.fetchWorkspaces();
    await loadWorktrees();
    toast.success(`Worktree removed: ${workspace}:${worktreeConfirmLabel(wt)}`);
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

  async function performDeleteBranch(workspace: string, branch: BranchEntry, remote: boolean): Promise<boolean> {
    const { ok } = await apiCommand(wsEndpoint(workspace, "delete-branch"), { branch: branch.name, remote }, {
      errorMessage: remote ? "Failed to delete remote branch" : "Failed to delete branch",
    });
    if (ok && remote) invalidateRemoteCache(workspace);
    return ok;
  }

  /** リモートブランチ一覧（branch.remote: true）側の単独削除ボタン用。 */
  async function deleteBranch(branch: BranchEntry) {
    await withWorkspace(async (workspace) => {
      const label = branch.remote ? "remote branch" : "local branch";
      if (!await confirmIrreversible(confirm, `Delete ${label} "${branch.name}"?`)) return;
      if (!await performDeleteBranch(workspace, branch, !!branch.remote)) return;
      await loadBranchList();
      emit("git:commitDone");
      await fetchRemote();
    });
  }

  /**
   * ローカルブランチ一覧側の削除ボタン用。worktreeが紐づく場合も同じボタン・
   * 確認ダイアログに統合し、選択肢（Local only / Local + remote /
   * Remove worktree）で分岐する。
   */
  async function deleteLocalBranch(branch: BranchEntry) {
    // useBranchList.tsのlinkedWorktreeは（git-branch.tsのWorktree型、index
    // signature由来でunknown）を返すが、実体はremoveWorktreeRequest等と同じ
    // worktree APIオブジェクトのため、他の箇所と同じくWorktreeEntryとして扱う。
    const wt = linkedWorktree(branch) as WorktreeEntry | null;
    await withWorkspace(async (workspace) => {
      let residue: Residue | null = null;
      let worktreeDesc: string | undefined;
      if (wt) {
        const wsName = wt.workspace || wt.name || worktreeWorkspaceName(workspace, wt.branch);
        residue = await findResidue(wt, wsName);
        const note = worktreeResidueNote({
          openTabs: residue.openTabs.length,
          detachedSessions: residue.detachedSessions.length,
          devServers: residue.devServers.length,
        });
        worktreeDesc = note
          ? `The working tree directory will be deleted. ${note}`
          : "The working tree directory will be deleted.";
      }
      const choice = await confirmDeleteBranch(confirm, branch, { worktreeDesc });
      if (choice === false) return;
      if (choice === "worktree") {
        if (!wt || !residue) return;
        await removeWorktreeNow(workspace, wt, residue);
        return;
      }
      if (!await performDeleteBranch(workspace, branch, false)) return;
      if (choice === "remote") {
        await performDeleteBranch(workspace, branch, true);
      }
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
    pushBranch,
    pullBranch,
    deleteBranch,
    deleteLocalBranch,
    backgroundFetch,
    fetchRemote,
  };
}
