import { reactive } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { useConfirm } from "./useConfirm.ts";
import { useToast } from "./useToast.ts";
import { formatRemoteToast } from "../utils/git-remote.ts";
import { TOAST_DEFAULT_DURATION_MS, TOAST_DETAIL_DURATION_MS } from "../utils/constants.ts";

const REMOTE_ACTIONS: Record<string, { label: string, confirm: string }> = {
  pull: { label: "Pull", confirm: "pull" },
  push: { label: "Push", confirm: "push" },
  "push-branch": { label: "Push", confirm: "push" },
  "push-upstream": { label: "Push (set upstream)", confirm: "set upstream and push" },
  "set-upstream": { label: "Set Upstream", confirm: "set upstream tracking" },
};

// commit 件数トーストを出す push/pull 系アクション（runPushPull で処理する）
const PUSH_PULL_ACTIONS = new Set(["pull", "push", "push-branch", "push-upstream"]);

function actionLabel(action: string) {
  return REMOTE_ACTIONS[action]?.label || action;
}

function makeActionKey(wsName: string | null, action: string, branch?: string) {
  return action === "push-branch" && branch
    ? `${wsName}:${action}:${branch}`
    : `${wsName}:${action}`;
}

function buildConfirmMessage(wsName: string, action: string, branch?: string) {
  const label = actionLabel(action);
  const confirmText = REMOTE_ACTIONS[action]?.confirm || `execute ${label}`;
  const lines = [`Repository: ${wsName}`];
  if (branch) lines.push(`Branch: ${branch}`);
  lines.push("", confirmText);
  return lines.join("\n");
}

// 分割表示で同じワークスペースを複数ペインが開いている場合、pull/push の
// 実行中状態をペインごとに独立させると、他ペインのボタンが押せてしまい
// 同じリポジトリへの並行実行（git lock 競合等）が起きる。モジュールスコープの
// 単一状態にして、どのペインの useGitRemoteAction() からも共有する。ロックの
// 粒度はワークスペース単位ではなく物理リポジトリ単位（同じリポジトリへは
// 同時に1操作まで）にし、無関係な他リポジトリの操作まで巻き込んで
// ブロックしないようにする。linked worktree はベースと同じリポジトリ・
// 同じリモートrefを共有するため、ワークスペース名ではなく worktree_base
// （無ければ自分自身の名前）をキーにする。
/** リポジトリキー -> 実行中のアクションキー */
const runningActionByWorkspace = reactive(new Map<string, string>());

export function useGitRemoteAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiWithToast, apiCommand, wsEndpoint } = useApi();
  const { confirm } = useConfirm();
  const toast = useToast();

  function repoKeyFor(wsName: string | null) {
    const ws = workspaceStore.allWorkspaces.find((w) => w.name === wsName);
    return (ws?.worktree && ws.worktree_base) || wsName;
  }

  async function runPushPull(wsName: string, action: string, branch: string | undefined, label: string) {
    const body = action === "push-branch" ? { branch } : {};
    const { ok, data } = await apiCommand(wsEndpoint(wsName, action), body, { errorMessage: `${label} failed` });
    if (!ok) return;
    const message = formatRemoteToast(wsName, label, data);
    const hasDetail = message.includes("\n");
    toast.success(message, { duration: hasDetail ? TOAST_DETAIL_DURATION_MS : TOAST_DEFAULT_DURATION_MS, action: { event: "git:openHistory", wsName } });
    workspaceStore.fetchStatuses();
  }

  async function runGenericAction(wsName: string, action: string, label: string) {
    await apiWithToast(wsEndpoint(wsName, action), {}, {
      successMessage: `${wsName}: ${label} done`,
      errorMessage: `${label} failed`,
      onSuccess: () => workspaceStore.fetchStatuses(),
    });
  }

  async function gitAction(wsName: string, action: string, opts: { branch?: string } = {}) {
    const { branch } = opts;
    const repoKey = repoKeyFor(wsName);
    if (runningActionByWorkspace.has(repoKey)) return;
    if (!await confirm(buildConfirmMessage(wsName, action, branch))) return;
    runningActionByWorkspace.set(repoKey, makeActionKey(wsName, action, branch));
    try {
      const label = actionLabel(action);
      if (PUSH_PULL_ACTIONS.has(action)) {
        await runPushPull(wsName, action, branch, label);
      } else {
        await runGenericAction(wsName, action, label);
      }
    } finally {
      runningActionByWorkspace.delete(repoKey);
    }
  }

  function isRunning(wsName: string | null, action: string, branch?: string) {
    return runningActionByWorkspace.get(repoKeyFor(wsName)) === makeActionKey(wsName, action, branch);
  }

  function isAnyRunning(wsName?: string | null) {
    return wsName ? runningActionByWorkspace.has(repoKeyFor(wsName)) : runningActionByWorkspace.size > 0;
  }

  return { gitAction, isRunning, isAnyRunning };
}
