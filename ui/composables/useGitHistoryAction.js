import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { emit } from "../app-bridge.js";

export function useGitHistoryAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiWithToast, wsEndpoint } = useApi();

  async function runAndToast(endpoint, body, { successMessage, errorMessage }) {
    await apiWithToast(endpoint, body, {
      successMessage,
      errorMessage,
      onSuccess: () => emit("git:refresh"),
    });
  }

  async function confirmAndRun(msg, endpoint, body, toastOpts, closeFn) {
    if (!confirm(msg)) return;
    closeFn?.();
    await runAndToast(endpoint, body, toastOpts);
  }

  async function execAction(action, entry, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const shortHash = entry.hash;
    await confirmAndRun(
      `Execute ${action} ${shortHash}?`,
      wsEndpoint(workspace, action),
      { commit_hash: entry.fullHash },
      { successMessage: `${action} ${shortHash} done`, errorMessage: `${action} failed` },
      closeFn,
    );
  }

  async function execReset(entry, mode, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const shortHash = entry.hash;
    const msg = mode === "hard"
      ? `reset --hard ${shortHash} will be executed. All working tree changes will be lost. Continue?`
      : `Execute reset --soft ${shortHash}?`;
    await confirmAndRun(
      msg,
      wsEndpoint(workspace, "reset"),
      { commit_hash: entry.fullHash, mode },
      { successMessage: `reset --${mode} ${shortHash} done`, errorMessage: `reset --${mode} failed` },
      closeFn,
    );
  }

  async function execCreateBranch(entry, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const branchName = prompt("Enter new branch name:");
    if (!branchName) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, "create-branch"), { branch: branchName, start_point: entry.fullHash }, {
      successMessage: `Branch ${branchName} created`,
      errorMessage: "Failed to create branch",
    });
  }

  async function execMerge(branch, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    await confirmAndRun(
      `Merge ${branch} into current branch?`,
      wsEndpoint(workspace, "merge"),
      { branch },
      { successMessage: `${branch} merged`, errorMessage: "Merge failed" },
      closeFn,
    );
  }

  async function execRebase(branch, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    await confirmAndRun(
      `Rebase onto ${branch}?`,
      wsEndpoint(workspace, "rebase"),
      { branch },
      { successMessage: `Rebased onto ${branch}`, errorMessage: "Rebase failed" },
      closeFn,
    );
  }

  return { execAction, execReset, execCreateBranch, execMerge, execRebase };
}
