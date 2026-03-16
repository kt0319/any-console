import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { extractApiError } from "../utils/constants.js";

export function useGitCommitAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiCommand, wsEndpoint } = useApi();

  function currentWorkspace() {
    return workspaceStore.selectedWorkspace || null;
  }

  async function runAndToast(endpoint, body, { successMessage, errorMessage }) {
    try {
      const { ok, data } = await apiCommand(endpoint, body);
      if (!ok) {
        bridgeEmit("toast:show", { message: extractApiError(data, errorMessage), type: "error" });
        return;
      }
      bridgeEmit("toast:show", { message: successMessage, type: "success" });
      bridgeEmit("git:refresh");
    } catch (e) {
      bridgeEmit("toast:show", { message: e.message, type: "error" });
    }
  }

  async function execAction(action, entry, closeFn) {
    const workspace = currentWorkspace();
    if (!workspace) return;
    const shortHash = entry.hash;
    if (!confirm(`${action} ${shortHash} を実行しますか？`)) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, action), { commit_hash: entry.fullHash }, {
      successMessage: `${action} ${shortHash} 完了`,
      errorMessage: `${action}に失敗しました`,
    });
  }

  async function execReset(entry, mode, closeFn) {
    const workspace = currentWorkspace();
    if (!workspace) return;
    const shortHash = entry.hash;
    const msg = mode === "hard"
      ? `reset --hard ${shortHash} を実行します。作業ツリーの変更はすべて失われます。実行しますか？`
      : `reset --soft ${shortHash} を実行しますか？`;
    if (!confirm(msg)) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, "reset"), { commit_hash: entry.fullHash, mode }, {
      successMessage: `reset --${mode} ${shortHash} 完了`,
      errorMessage: `reset --${mode}に失敗しました`,
    });
  }

  async function execCreateBranch(entry, closeFn) {
    const workspace = currentWorkspace();
    if (!workspace) return;
    const branchName = prompt("新しいブランチ名を入力してください:");
    if (!branchName) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, "create-branch"), { branch: branchName, start_point: entry.fullHash }, {
      successMessage: `ブランチ ${branchName} を作成しました`,
      errorMessage: "ブランチ作成に失敗しました",
    });
  }

  async function execMerge(branch, closeFn) {
    const workspace = currentWorkspace();
    if (!workspace) return;
    if (!confirm(`${branch} を現在のブランチにマージしますか？`)) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, "merge"), { branch }, {
      successMessage: `${branch} をマージしました`,
      errorMessage: "マージに失敗しました",
    });
  }

  async function execRebase(branch, closeFn) {
    const workspace = currentWorkspace();
    if (!workspace) return;
    if (!confirm(`${branch} にリベースしますか？`)) return;
    closeFn?.();
    await runAndToast(wsEndpoint(workspace, "rebase"), { branch }, {
      successMessage: `${branch} にリベースしました`,
      errorMessage: "リベースに失敗しました",
    });
  }

  return { execAction, execReset, execCreateBranch, execMerge, execRebase };
}
