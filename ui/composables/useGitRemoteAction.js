import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { useConfirm } from "./useConfirm.js";
import { emit } from "../app-bridge.js";

const ACTION_LABELS = {
  pull: "Pull",
  push: "Push",
  "push-branch": "Push",
  "push-upstream": "Push (set upstream)",
  "set-upstream": "Set Upstream",
};

const ACTION_CONFIRM = {
  pull: "pull",
  push: "push",
  "push-branch": "push",
  "push-upstream": "set upstream and push",
  "set-upstream": "set upstream tracking",
};

export function useGitRemoteAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiWithToast, apiCommand, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const runningAction = ref(null);

  /**
   * @param {string} wsName
   * @param {string} action
   * @param {{ branch?: string }} [opts]
   */
  async function gitAction(wsName, action, opts = {}) {
    const { branch } = opts;
    if (runningAction.value) return;
    const label = ACTION_LABELS[action] || action;
    const confirmText = ACTION_CONFIRM[action] || `execute ${label}`;
    const lines = [`Repository: ${wsName}`];
    if (branch) lines.push(`Branch: ${branch}`);
    lines.push("", confirmText);
    const msg = lines.join("\n");
    if (!await confirm(msg)) return;
    runningAction.value = branch ? `${wsName}:${action}:${branch}` : `${wsName}:${action}`;
    try {
      if (action === "pull" || action === "push" || action === "push-branch") {
        const body = action === "push-branch" ? { branch } : {};
        const { ok, data } = await apiCommand(wsEndpoint(wsName, action), body, { errorMessage: `${label} failed` });
        if (ok) {
          const message = formatRemoteToast(wsName, label, data);
          const hasDetail = message.includes("\n");
          emit("toast:show", { message, type: "success", duration: hasDetail ? 5000 : 3000 });
          workspaceStore.fetchStatuses();
        }
      } else {
        await apiWithToast(wsEndpoint(wsName, action), {}, {
          successMessage: `${wsName}: ${label} done`,
          errorMessage: `${label} failed`,
          onSuccess: () => workspaceStore.fetchStatuses(),
        });
      }
    } finally {
      runningAction.value = null;
    }
  }

  function formatRemoteToast(wsName, label, data) {
    const commits = data?.commits;
    const count = commits?.count || 0;
    const header = count > 0
      ? `${wsName}: ${label} done (${count} commit${count === 1 ? "" : "s"})`
      : `${wsName}: ${label} done`;
    const messages = Array.isArray(commits?.messages) ? commits.messages : [];
    const subjects = messages.map((m) => String(m).split("\n")[0]);
    if (!subjects.length) return header;
    const lines = [header, ...subjects.map((s) => `• ${s}`)];
    const remaining = count - subjects.length;
    if (remaining > 0) {
      lines.push(`… and ${remaining} more`);
    }
    return lines.join("\n");
  }

  function isRunning(wsName, action, branch) {
    const key = branch ? `${wsName}:${action}:${branch}` : `${wsName}:${action}`;
    return runningAction.value === key;
  }

  function isAnyRunning() {
    return runningAction.value !== null;
  }

  return { runningAction, gitAction, isRunning, isAnyRunning };
}
