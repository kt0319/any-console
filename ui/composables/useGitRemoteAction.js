import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { useConfirm } from "./useConfirm.js";
import { useToast } from "./useToast.js";
import { formatRemoteToast } from "../utils/git-remote.js";

/** @type {Record<string, { label: string, confirm: string }>} */
const REMOTE_ACTIONS = {
  pull: { label: "Pull", confirm: "pull" },
  push: { label: "Push", confirm: "push" },
  "push-branch": { label: "Push", confirm: "push" },
  "push-upstream": { label: "Push (set upstream)", confirm: "set upstream and push" },
  "set-upstream": { label: "Set Upstream", confirm: "set upstream tracking" },
};

const PUSH_ACTIONS = new Set(["pull", "push", "push-branch"]);

function actionLabel(action) {
  return REMOTE_ACTIONS[action]?.label || action;
}

function makeActionKey(wsName, action, branch) {
  return action === "push-branch" && branch
    ? `${wsName}:${action}:${branch}`
    : `${wsName}:${action}`;
}

function buildConfirmMessage(wsName, action, branch) {
  const label = actionLabel(action);
  const confirmText = REMOTE_ACTIONS[action]?.confirm || `execute ${label}`;
  const lines = [`Repository: ${wsName}`];
  if (branch) lines.push(`Branch: ${branch}`);
  lines.push("", confirmText);
  return lines.join("\n");
}

export function useGitRemoteAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiWithToast, apiCommand, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const toast = useToast();
  const runningAction = ref(/** @type {string|null} */ (null));

  /**
   * @param {string} wsName
   * @param {string} action
   * @param {string | undefined} branch
   * @param {string} label
   */
  async function runPushPull(wsName, action, branch, label) {
    const body = action === "push-branch" ? { branch } : {};
    const { ok, data } = await apiCommand(wsEndpoint(wsName, action), body, { errorMessage: `${label} failed` });
    if (!ok) return;
    const message = formatRemoteToast(wsName, label, data);
    const hasDetail = message.includes("\n");
    toast.success(message, { duration: hasDetail ? 5000 : 3000, action: { event: "git:openHistory", wsName } });
    workspaceStore.fetchStatuses();
  }

  async function runGenericAction(wsName, action, label) {
    await apiWithToast(wsEndpoint(wsName, action), {}, {
      successMessage: `${wsName}: ${label} done`,
      errorMessage: `${label} failed`,
      onSuccess: () => workspaceStore.fetchStatuses(),
    });
  }

  async function gitAction(wsName, action, opts = {}) {
    const { branch } = opts;
    if (runningAction.value) return;
    if (!await confirm(buildConfirmMessage(wsName, action, branch))) return;
    runningAction.value = makeActionKey(wsName, action, branch);
    try {
      const label = actionLabel(action);
      if (PUSH_ACTIONS.has(action)) {
        await runPushPull(wsName, action, branch, label);
      } else {
        await runGenericAction(wsName, action, label);
      }
    } finally {
      runningAction.value = null;
    }
  }

  function isRunning(wsName, action, branch) {
    return runningAction.value === makeActionKey(wsName, action, branch);
  }

  function isAnyRunning() {
    return runningAction.value !== null;
  }

  return { runningAction, gitAction, isRunning, isAnyRunning };
}
