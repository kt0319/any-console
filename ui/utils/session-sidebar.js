import { workspaceDisplayName } from "./worktree.js";
import { findPRForBranch, findRunForBranch, isNoticeableRun, runStatusClass, runStatusIcon } from "./github-runs.js";
import { dispatchWorkspaceLabel } from "./dispatch-request.js";
import { buildInfoPillTooltips } from "./info-pill-tooltips.js";

// セッションサイドバー（TabBar のハンバーガーから開く一覧）の表示行を
// 組み立てる純粋関数群。SessionListView.vue から使う。

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
 * InfoPillRow用の派生フィールド（Branch/Changes/PR/Actions/DevServer/Dispatch）を
 * ワークスペース名単位でまとめて計算する。開いているタブの行（sessionSidebarItems）と
 * タブが無い承認待ちワークスペースの行（pendingDispatchSidebarItems）の両方から
 * 共有する（同じワークスペースなら同じピルが同じ内容で出るようにするため）。
 * @param {string | null | undefined} wsName
 * @param {any} ws workspaceStore.allWorkspaces の該当エントリ（無ければ undefined）
 * @param {{
 *   prsByWorkspace?: Record<string, any[]>,
 *   runsByWorkspace?: Record<string, any[]>,
 *   previewPorts?: any[],
 *   dispatchQueue?: {request: Record<string, any>}[],
 *   hostname?: string,
 * }} ctx
 */
function buildPillFields(wsName, ws, ctx) {
  const { prsByWorkspace = {}, runsByWorkspace = {}, previewPorts = [], dispatchQueue = [], hostname = "" } = ctx;
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
  const branchPR = isGitRepo && wsName ? findPRForBranch(prsByWorkspace[wsName], branch) : null;
  /** @type {any} */
  const branchAction = isGitRepo && wsName ? findRunForBranch(runsByWorkspace[wsName], branch) : null;
  const visibleBranchAction = isNoticeableRun(branchAction) ? branchAction : null;
  const devServerEntry = wsName
    ? (previewPorts.find((p) => p.workspace === wsName && p.proxy_port) || null)
    : null;
  const dispatchItems = wsName
    ? dispatchQueue.filter((item) => dispatchWorkspaceLabel(item.request) === wsName)
    : [];
  return {
    isGitRepo,
    branch,
    dirty: ws?.clean === false,
    ahead,
    behind,
    changedFiles,
    insertions,
    deletions,
    hasPr: !!branchPR,
    hasAction: !!visibleBranchAction,
    actionStatusClass: runStatusClass(branchAction),
    actionStatusIcon: runStatusIcon(),
    hasDevServer: !!devServerEntry,
    devServerEntry,
    dispatchCount: dispatchItems.length,
    dispatchItems,
    tooltips: buildInfoPillTooltips({
      name: wsName || "", isGitRepo,
      branch, ahead, behind, hasUpstream: ws?.has_upstream !== false,
      changedFiles, insertions, deletions,
      lastCommitMessage: ws?.last_commit_message,
      devServerEntry, hostname,
      dispatchItems,
      branchPR, branchAction,
    }),
  };
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
  const { tabFlags = {}, agentStates = {}, phraseNotifySessions = {} } = ctx;
  return (tabs || [])
    .filter((tab) => !tabFlags[tab.id]?.autoDiscovered)
    .map((tab) => {
      const ws = tab.workspace ? (workspaces || []).find((w) => w.name === tab.workspace) : undefined;
      const label = ws?.worktree ? workspaceDisplayName(ws) : (tab.workspace || tab.label || "terminal");
      const pill = buildPillFields(tab.workspace, ws, ctx);
      return {
        tab,
        id: tab.id,
        sessionId: tab.sessionId,
        label,
        icon: tab.wsIcon || tab.icon || null,
        // TabItem.vueと同じく、ワークスペースアイコンとジョブアイコンは
        // 別枠として両方出す（wsIconがある時、iconは隠れず併記される）。
        wsIcon: tab.wsIcon || null,
        jobIcon: tab.icon || null,
        isWorktree: !!ws?.worktree,
        ...pill,
        agent: agentStateDescriptor(agentStates[tab.sessionId]),
        phraseNotify: !!phraseNotifySessions[tab.sessionId],
      };
    });
}

/**
 * タブがまだ無い（=通常のセッション行が存在しない）ワークスペースの承認待ち
 * dispatchを、通常のセッション行と同じ情報（Branch/Changes/PR/Actions/
 * DevServer/Dispatchの各ピル）で出すための行データ。openTabWorkspaceNamesに
 * 含まれるワークスペースは対象外（既にセッション行のピルで足りるため）。
 * @param {any[]} workspaces workspaceStore.allWorkspaces
 * @param {Set<string>} openTabWorkspaceNames
 * @param {Parameters<typeof sessionSidebarItems>[2]} [ctx] sessionSidebarItemsと同じctx
 */
export function pendingDispatchSidebarItems(workspaces, openTabWorkspaceNames, ctx = {}) {
  const { dispatchQueue = [] } = ctx;
  const names = new Set();
  for (const item of dispatchQueue) {
    const wsName = dispatchWorkspaceLabel(item.request);
    if (wsName && !openTabWorkspaceNames.has(wsName)) names.add(wsName);
  }
  return Array.from(names).map((wsName) => {
    const ws = (workspaces || []).find((w) => w.name === wsName);
    const pill = buildPillFields(wsName, ws, ctx);
    return {
      workspace: wsName,
      label: ws?.worktree ? workspaceDisplayName(ws) : wsName,
      wsIcon: ws?.icon ? { name: ws.icon, color: ws.icon_color } : null,
      jobIcon: null,
      isWorktree: !!ws?.worktree,
      // SessionRowContent.vueのagentステータスバッジをそのまま流用し、
      // 「Pending」であることを他の行のWorking/Blocked等と同じ見せ方で示す。
      agent: { icon: "mdi-tray-full", label: "Pending", className: "agent-state-dispatch-pending" },
      phraseNotify: false,
      ...pill,
    };
  });
}
