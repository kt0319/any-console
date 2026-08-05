import { useApi } from "./useApi.js";
import { useWorkspace } from "./useWorkspace.js";
import { useConfirm } from "./useConfirm.js";
import { usePrompt } from "./usePrompt.js";

export function useGitHistoryAction() {
  const { withWorkspace } = useWorkspace();
  const { apiWithToast, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();

  async function runAndToast(endpoint, body, { successMessage, errorMessage }) {
    await apiWithToast(endpoint, body, { successMessage, errorMessage });
  }

  async function confirmAndRun(msg, fn, closeFn) {
    await withWorkspace(async (workspace) => {
      if (!await confirm(msg)) return;
      closeFn?.();
      await fn(workspace);
    });
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

  // Soft/Mixed/Hardの3択を1つのダイアログで選ばせる。OKボタンをSoft（安全側の
  // 既定）に割り当て、Mixed/Hardはconfirm()のextra/extra2ボタンを使う
  // （confirm()の戻り値はOK=true、extra/extra2=それぞれの value 文字列、
  // Cancel=false）。
  async function execReset(entry, closeFn) {
    const shortHash = entry.hash;
    const choice = await confirm(`Reset to ${shortHash}?`, {
      ok: { label: "Soft" },
      extra: { label: "Mixed", value: "mixed" },
      extra2: {
        label: "Hard", value: "hard", icon: "mdi-alert-outline",
        desc: "Hard: all working tree changes will be lost.",
      },
    });
    if (choice === false) return;
    const mode = choice === true ? "soft" : choice;
    await withWorkspace(async (workspace) => {
      closeFn?.();
      await runAndToast(wsEndpoint(workspace, "reset"), { commit_hash: entry.fullHash, mode }, {
        successMessage: `reset --${mode} ${shortHash} done`,
        errorMessage: `reset --${mode} failed`,
      });
    });
  }

  async function execCreateBranch(entry, closeFn) {
    await withWorkspace(async (workspace) => {
      const branchName = await prompt({
        title: "Create Branch",
        message: "Enter new branch name.",
        initialValue: "",
        placeholder: "feature/example",
      });
      if (!branchName) return;
      closeFn?.();
      await runAndToast(wsEndpoint(workspace, "create-branch"), { branch: branchName, start_point: entry.fullHash }, {
        successMessage: `Branch ${branchName} created`,
        errorMessage: "Failed to create branch",
      });
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
