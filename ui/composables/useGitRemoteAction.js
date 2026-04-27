import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";

const ACTION_LABELS = {
  pull: "Pull",
  push: "Push",
  "push-upstream": "Push (set upstream)",
  "set-upstream": "Set Upstream",
};

const ACTION_CONFIRM = {
  pull: "pull",
  push: "push",
  "push-upstream": "set upstream and push",
  "set-upstream": "set upstream tracking",
};

export function useGitRemoteAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiWithToast, wsEndpoint } = useApi();
  const runningAction = ref(null);

  async function gitAction(wsName, action, { branch } = {}) {
    if (runningAction.value) return;
    const label = ACTION_LABELS[action] || action;
    const confirmText = ACTION_CONFIRM[action] || `execute ${label}`;
    const lines = [`Repository: ${wsName}`];
    if (branch) lines.push(`Branch: ${branch}`);
    lines.push("", confirmText);
    const msg = lines.join("\n");
    if (!confirm(msg)) return;
    runningAction.value = `${wsName}:${action}`;
    try {
      await apiWithToast(wsEndpoint(wsName, action), {}, {
        successMessage: `${wsName}: ${label} done`,
        errorMessage: `${label} failed`,
        onSuccess: () => workspaceStore.fetchStatuses(),
      });
    } finally {
      runningAction.value = null;
    }
  }

  function isRunning(wsName, action) {
    return runningAction.value === `${wsName}:${action}`;
  }

  function isAnyRunning() {
    return runningAction.value !== null;
  }

  return { runningAction, gitAction, isRunning, isAnyRunning };
}
