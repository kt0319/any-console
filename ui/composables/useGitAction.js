import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";

const ACTION_LABELS = {
  pull: "Pull",
  push: "Push",
  "push-upstream": "Push (upstream設定)",
  "set-upstream": "追跡設定",
};

const ACTION_CONFIRM = {
  pull: "pullします",
  push: "pushします",
  "push-upstream": "upstream設定してpushします",
  "set-upstream": "追跡設定します",
};

export function useGitAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiWithToast, wsEndpoint } = useApi();
  const runningAction = ref(null);

  async function gitAction(wsName, action, { branch } = {}) {
    if (runningAction.value) return;
    const label = ACTION_LABELS[action] || action;
    const confirmText = ACTION_CONFIRM[action] || `${label}を実行します`;
    const lines = [`リポジトリ：${wsName}`];
    if (branch) lines.push(`ブランチ：${branch}`);
    lines.push("", confirmText);
    const msg = lines.join("\n");
    if (!confirm(msg)) return;
    runningAction.value = `${wsName}:${action}`;
    try {
      await apiWithToast(wsEndpoint(wsName, action), {}, {
        successMessage: `${wsName}: ${label}完了`,
        errorMessage: `${label}に失敗しました`,
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
