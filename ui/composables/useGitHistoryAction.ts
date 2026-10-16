import { useApi } from "./useApi.ts";
import { useWorkspace } from "./useWorkspace.ts";
import { useConfirm } from "./useConfirm.ts";
import { usePrompt } from "./usePrompt.ts";

type CommitEntry = { hash: string, fullHash: string };

export function useGitHistoryAction() {
  const { withWorkspace } = useWorkspace();
  const { apiWithPeek, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const { prompt } = usePrompt();

  async function runAndPeek(
    workspace: string,
    action: string,
    body: Record<string, any>,
    { headline, detail, errorMessage }: { headline: string, detail: string, errorMessage: string },
  ) {
    await apiWithPeek(wsEndpoint(workspace, action), body, { wsName: workspace, headline, detail, errorMessage });
  }

  async function confirmAndRun(msg: string, fn: (ws: string) => Promise<void>, closeFn?: () => void) {
    await withWorkspace(async (workspace) => {
      if (!await confirm(msg)) return;
      closeFn?.();
      await fn(workspace);
    });
  }

  async function execAction(action: string, entry: CommitEntry, closeFn?: () => void) {
    const shortHash = entry.hash;
    await confirmAndRun(
      `Execute ${action} ${shortHash}?`,
      (ws) => runAndPeek(ws, action, { commit_hash: entry.fullHash }, {
        headline: `${action} done`,
        detail: shortHash,
        errorMessage: `${action} failed`,
      }),
      closeFn,
    );
  }

  // Soft/Mixed/Hardの3択を1つのダイアログで選ばせる。OKボタンをSoft（安全側の
  // 既定）に割り当て、Mixed/Hardはconfirm()のextra/extra2ボタンを使う
  // （confirm()の戻り値はOK=true、extra/extra2=それぞれの value 文字列、
  // Cancel=false）。
  async function execReset(entry: CommitEntry, closeFn?: () => void) {
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
      await runAndPeek(workspace, "reset", { commit_hash: entry.fullHash, mode }, {
        headline: `reset --${mode} done`,
        detail: shortHash,
        errorMessage: `reset --${mode} failed`,
      });
    });
  }

  async function execCreateBranch(entry: CommitEntry, closeFn?: () => void) {
    await withWorkspace(async (workspace) => {
      const branchName = await prompt({
        title: "Create Branch",
        message: "Enter new branch name.",
        initialValue: "",
        placeholder: "feature/example",
      });
      if (!branchName) return;
      closeFn?.();
      await runAndPeek(workspace, "create-branch", { branch: branchName, start_point: entry.fullHash }, {
        headline: "Branch created",
        detail: branchName,
        errorMessage: "Failed to create branch",
      });
    });
  }

  async function execMerge(branch: string, closeFn?: () => void) {
    await confirmAndRun(
      `Merge ${branch} into current branch?`,
      (ws) => runAndPeek(ws, "merge", { branch }, {
        headline: "Merged",
        detail: branch,
        errorMessage: "Merge failed",
      }),
      closeFn,
    );
  }

  async function execRebase(branch: string, closeFn?: () => void) {
    await confirmAndRun(
      `Rebase onto ${branch}?`,
      (ws) => runAndPeek(ws, "rebase", { branch }, {
        headline: "Rebased",
        detail: `onto ${branch}`,
        errorMessage: "Rebase failed",
      }),
      closeFn,
    );
  }

  return { execAction, execReset, execCreateBranch, execMerge, execRebase };
}
