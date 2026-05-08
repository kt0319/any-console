import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { emit } from "../app-bridge.js";
import { useConfirm } from "./useConfirm.js";

export function useGitHistoryAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiWithToast, wsEndpoint } = useApi();
  const { confirm } = useConfirm();

  async function runAndToast(endpoint, body, { successMessage, errorMessage }) {
    await apiWithToast(endpoint, body, {
      successMessage,
      errorMessage,
      onSuccess: () => emit("git:refresh"),
    });
  }

  async function confirmAndRun(msg, fn, closeFn) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace || !await confirm(msg)) return;
    closeFn?.();
    await fn(workspace);
  }

  async function execAction(action, entry, closeFn) {
    const shortHash = entry.hash;
    await confirmAndRun(
      `Execute ${action} ${shortHash}?`,
      (ws) => runAndToast(wsEndpoint(ws, action), { commit_hash: entry.fullHash }, {
        successMessage: `${action} ${shortHash} done`,
        errorMessage: `${action} failed`,
      }),
      closeFn,
    );
  }

  async function execReset(entry, mode, closeFn) {
    const shortHash = entry.hash;
    const msg = mode === "hard"
      ? `reset --hard ${shortHash} will be executed. All working tree changes will be lost. Continue?`
      : `Execute reset --soft ${shortHash}?`;
    await confirmAndRun(
      msg,
      (ws) => runAndToast(wsEndpoint(ws, "reset"), { commit_hash: entry.fullHash, mode }, {
        successMessage: `reset --${mode} ${shortHash} done`,
        errorMessage: `reset --${mode} failed`,
      }),
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
    await confirmAndRun(
      `Merge ${branch} into current branch?`,
      (ws) => runAndToast(wsEndpoint(ws, "merge"), { branch }, {
        successMessage: `${branch} merged`,
        errorMessage: "Merge failed",
      }),
      closeFn,
    );
  }

  async function execRebase(branch, closeFn) {
    await confirmAndRun(
      `Rebase onto ${branch}?`,
      (ws) => runAndToast(wsEndpoint(ws, "rebase"), { branch }, {
        successMessage: `Rebased onto ${branch}`,
        errorMessage: "Rebase failed",
      }),
      closeFn,
    );
  }

  return { execAction, execReset, execCreateBranch, execMerge, execRebase };
}
