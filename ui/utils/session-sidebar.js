import { workspaceDisplayName } from "./worktree.js";
import { findPRForBranch, findRunForBranch, isNoticeableRun, runStatusClass, runStatusIcon } from "./github-runs.js";
import { dispatchWorkspaceLabel } from "./dispatch-request.js";
import { branchTooltip, filesTooltip, changesTooltip, historyTooltip, devServerTooltip, dispatchTooltip, prsTooltip, actionsTooltip } from "./info-pill-tooltips.js";

// セッションサイドバー（TabBar のハンバーガーから開く一覧）の表示行を
// 組み立てる純粋関数群。SessionSidebar.vue から使う。

/**
 * エージェント状態（terminalStore.agentStates の値）ごとの表示メタ。
 * 色のみで状態を示さないため、アイコンとラベルを必ず併記する。
 */
export const AGENT_STATE_META = Object.freeze({
  working: Object.freeze({ icon: "mdi-autorenew", label: "Working", className: "agent-state-working" }),
  blocked: Object.freeze({ icon: "mdi-alert-circle-outline", label: "Blocked", className: "agent-state-blocked" }),
  done: Object.freeze({ icon: "mdi-check-circle-outline", label: "Done", className: "agent-state-done" }),
  idle: Object.freeze({ icon: "mdi-sleep", label: "Idle", className: "agent-state-idle" }),
});

/**
 * エージェント状態の表示メタを返す（未知・未設定の状態は null）。
 * @param {string} [state]
 * @returns {{ icon: string, label: string, className: string } | null}
 */
export function agentStateDescriptor(state) {
  return (state && AGENT_STATE_META[state]) || null;
}

/**
 * サイドバーの表示行を組み立てる。TabBar と同じく autoDiscovered なタブは
 * 除外し、並び順も openTabs のまま（タブバーと一致）にする。
 *
 * InfoPillRow（TerminalPane と同じピル群）をサイドバーの各行にも出すため、
 * 判定に必要な生データ（PR一覧・Actions run一覧・Dev Server検出結果・
 * dispatchキュー）も ctx で受け取り、ここで各タブ分に絞り込む
 * （TerminalPane.vue の branchPR/branchAction/devServerEntry/tabDispatchItems
 *  と同じロジックを、複数タブ分まとめて処理する）。
 * @param {any[]} tabs terminalStore.openTabs
 * @param {any[]} workspaces workspaceStore.allWorkspaces
 * @param {{
 *   tabFlags?: Record<string|number, any>,
 *   agentStates?: Record<string, string>,
 *   phraseNotifySessions?: Record<string, boolean>,
 *   prsByWorkspace?: Record<string, any[]>,
 *   runsByWorkspace?: Record<string, any[]>,
 *   previewPorts?: any[],
 *   dispatchQueue?: {request: Record<string, any>}[],
 *   hostname?: string,
 * }} [ctx]
 */
export function sessionSidebarItems(tabs, workspaces, ctx = {}) {
  const {
    tabFlags = {}, agentStates = {}, phraseNotifySessions = {},
    prsByWorkspace = {}, runsByWorkspace = {}, previewPorts = [], dispatchQueue = [], hostname = "",
  } = ctx;
  return (tabs || [])
    .filter((tab) => !tabFlags[tab.id]?.autoDiscovered)
    .map((tab) => {
      const ws = tab.workspace ? (workspaces || []).find((w) => w.name === tab.workspace) : undefined;
      const label = ws?.worktree ? workspaceDisplayName(ws) : (tab.workspace || tab.label || "terminal");
      const isGitRepo = ws?.is_git_repo === true;
      const branch = ws?.branch || "";
      const ahead = ws?.ahead || 0;
      const behind = ws?.behind || 0;
      const changedFiles = ws?.changed_files || 0;
      const insertions = ws?.insertions || 0;
      const deletions = ws?.deletions || 0;
      // findPRForBranch/findRunForBranchのJSDoc戻り値型はマッチ用フィールドのみの
      // 狭い形（{headRefName}/{headBranch}）だが、実際のオブジェクトは
      // number/title/status/conclusion等も持つ。tsc（weak type検出）が
      // prsTooltip等への受け渡しをプロパティ無関係と誤検出しないよう any 扱いにする。
      /** @type {any} */
      const branchPR = isGitRepo && tab.workspace ? findPRForBranch(prsByWorkspace[tab.workspace], branch) : null;
      /** @type {any} */
      const branchAction = isGitRepo && tab.workspace ? findRunForBranch(runsByWorkspace[tab.workspace], branch) : null;
      const visibleBranchAction = isNoticeableRun(branchAction) ? branchAction : null;
      const devServerEntry = tab.workspace
        ? (previewPorts.find((p) => p.workspace === tab.workspace && p.proxy_port) || null)
        : null;
      const dispatchItems = tab.workspace
        ? dispatchQueue.filter((item) => dispatchWorkspaceLabel(item.request) === tab.workspace)
        : [];
      return {
        tab,
        id: tab.id,
        sessionId: tab.sessionId,
        label,
        icon: tab.wsIcon || tab.icon || null,
        isWorktree: !!ws?.worktree,
        isGitRepo,
        branch,
        dirty: ws?.clean === false,
        ahead,
        behind,
        changedFiles,
        insertions,
        deletions,
        agent: agentStateDescriptor(agentStates[tab.sessionId]),
        phraseNotify: !!phraseNotifySessions[tab.sessionId],
        hasPr: !!branchPR,
        hasAction: !!visibleBranchAction,
        actionStatusClass: runStatusClass(branchAction),
        actionStatusIcon: runStatusIcon(branchAction),
        hasDevServer: !!devServerEntry,
        devServerEntry,
        dispatchCount: dispatchItems.length,
        dispatchItems,
        tooltips: {
          files: filesTooltip({ name: label, isGitRepo }),
          history: historyTooltip(ws?.last_commit_message),
          changes: changesTooltip({ changedFiles, insertions, deletions }),
          branch: branchTooltip({ branch, ahead, behind, hasUpstream: ws?.has_upstream !== false }),
          devserver: devServerTooltip(devServerEntry, hostname),
          dispatch: dispatchTooltip(dispatchItems),
          prs: prsTooltip(branchPR),
          actions: actionsTooltip(branchAction),
        },
      };
    });
}
