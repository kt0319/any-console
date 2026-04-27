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

  async function execAction(action, entry, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const shortHash = entry.hash;
    if (!confirm(`Execute ${action} ${shortHash}?`)) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, action), { commit_hash: entry.fullHash }, {
      successMessage: `${action} ${shortHash} done`,
      errorMessage: `${action} failed`,
    });
  }

  async function execReset(entry, mode, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const shortHash = entry.hash;
    const msg = mode === "hard"
      ? `reset --hard ${shortHash} will be executed. All working tree changes will be lost. Continue?`
      : `Execute reset --soft ${shortHash}?`;
    if (!confirm(msg)) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, "reset"), { commit_hash: entry.fullHash, mode }, {
      successMessage: `reset --${mode} ${shortHash} done`,
      errorMessage: `reset --${mode} failed`,
    });
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
    if (!confirm(`Merge ${branch} into current branch?`)) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, "merge"), { branch }, {
      successMessage: `${branch} merged`,
      errorMessage: "Merge failed",
    });
  }

  async function execRebase(branch, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    if (!confirm(`Rebase onto ${branch}?`)) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, "rebase"), { branch }, {
      successMessage: `Rebased onto ${branch}`,
      errorMessage: "Rebase failed",
    });
  }

  return { execAction, execReset, execCreateBranch, execMerge, execRebase };
}
