import { reactive } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { useConfirm } from "./useConfirm.ts";
import { buildRemoteResult, type RemoteLabel } from "../utils/git-remote.ts";
import { emit } from "../app-bridge.ts";

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

// 分割表示で複数ペインが同じリポジトリへ並行実行（git lock 競合）しないよう、実行中状態はモジュールスコープで共有する。
// ロックは物理リポジトリ単位。linked worktree はベースと同じリモートrefを共有するため worktree_base（無ければ自分の名前）をキーにする。
/** リポジトリキー -> 実行中のアクションキー */
const runningActionByWorkspace = reactive(new Map<string, string>());

export function useGitRemoteAction() {
  const workspaceStore = useWorkspaceStore();
  const { apiWithPeek, apiCommand, wsEndpoint } = useApi();
  const { confirm } = useConfirm();

  function repoKeyFor(wsName: string | null) {
    const ws = workspaceStore.allWorkspaces.find((w) => w.name === wsName);
    return (ws?.worktree && ws.worktree_base) || wsName;
  }

  // PUSH_PULL_ACTIONS のガード下でのみ呼ばれるため label は RemoteLabel の3種に限られる。
  async function runPushPull(wsName: string, action: string, branch: string | undefined, label: RemoteLabel) {
    const body = action === "push-branch" ? { branch } : {};
    const { ok, data } = await apiCommand(wsEndpoint(wsName, action), body, { errorMessage: `${label} failed` });
    if (!ok) return;
    // 結果はトーストではなくbranch peekピル（usePillPeek.ts）が表示する。
    // ahead/behind更新による「N Pushed/Pulled」検出より先に届くよう、fetchStatusesの前に通知する。
    emit("git:actionResult", { wsName, result: buildRemoteResult(label, data) });
    // 呼び出し元（useBranchActions.ts）がこの後 emit("git:historyInvalidated") する
    // ため、aheadの更新（GitHistory.vueのunpushed表示が参照する）が
    // 確実に反映されてからemitされるようawaitする。
    await workspaceStore.fetchStatuses();
  }

  async function runGenericAction(wsName: string, action: string, label: string) {
    await apiWithPeek(wsEndpoint(wsName, action), {}, {
      wsName,
      headline: `${label} done`,
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
        await runPushPull(wsName, action, branch, label as RemoteLabel);
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
