import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { emit } from "../app-bridge.js";

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
  const { apiCommand, wsEndpoint } = useApi();
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
      const { ok, data } = await apiCommand(wsEndpoint(wsName, action));
      if (!ok) {
        emit("toast:show", { message: data?.message || data?.stderr || `${label}に失敗しました`, type: "error" });
        return;
      }
      emit("toast:show", { message: `${wsName}: ${label}完了`, type: "success" });
      workspaceStore.fetchStatuses();
    } catch (e) {
      emit("toast:show", { message: e.message, type: "error" });
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
