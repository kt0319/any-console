import { findPRForBranch, findRunForBranch, isNoticeableRun } from "./github-runs.ts";
import { dispatchWorkspaceLabel } from "./dispatch-request.ts";
import { buildInfoPillTooltips } from "./info-pill-tooltips.ts";

// セッションサイドバー（TabBar のハンバーガーから開く一覧）の表示行を
// 組み立てる純粋関数群。SessionListView.vue から使う。

/**
 * エージェント状態（terminalStore.agentStates の値）ごとの表示メタ。
 * 色のみで状態を示さないため、アイコンとラベルを必ず併記する。
 * idleは「何もしていない」通常状態でありノイズになるためバッジを出さない
 * （resolveAgentBadgeState が idle を常に null に潰す）。
 */
export const AGENT_STATE_META = Object.freeze({
  working: Object.freeze({ icon: "mdi-autorenew", label: "Working", className: "agent-state-working" }),
  blocked: Object.freeze({ icon: "mdi-alert-circle-outline", label: "Blocked", className: "agent-state-blocked" }),
  done: Object.freeze({ icon: "mdi-check-circle-outline", label: "Done", className: "agent-state-done" }),
});

/**
 * 生のエージェント状態(working/blocked/idle)と doneSessions（working→idle
 * 遷移をタブを見るまで保持するフラグ）から、バッジ表示に使う実効状態を
 * 決める。idleはdoneでない限り常に非表示。
 */
export function resolveAgentBadgeState(rawState?: string, isDone?: boolean): string | null {
  if (isDone) return "done";
  if (!rawState || rawState === "idle") return null;
  return rawState;
}

/**
 * エージェント状態の表示メタを返す（未知・未設定の状態は null）。
 */
export function agentStateDescriptor(state?: string | null): { icon: string; label: string; className: string } | null {
  return (state && AGENT_STATE_META[state as keyof typeof AGENT_STATE_META]) || null;
}

/**
 * InfoPillRow用の派生フィールド（Branch/Changes/PR/Actions/DevServer/Dispatch）をワークスペース
 * 名単位でまとめて計算する。sessionSidebarItems と pendingDispatchSidebarItems の両方から共有する
 * （同じワークスペースなら同じピルが同じ内容で出るようにするため）。
 * @param ws workspaceStore.allWorkspaces の該当エントリ（無ければ undefined）
 */
function buildPillFields(
  wsName: string | null | undefined,
  ws: any,
  ctx: {
    prsByWorkspace?: Record<string, any[]>;
    runsByWorkspace?: Record<string, any[]>;
    previewPorts?: any[];
    dispatchQueue?: { request: Record<string, any> }[];
    dispatchAllJobs?: Record<string, Record<string, { label?: string }>>;
    hostname?: string;
  },
) {
  const { prsByWorkspace = {}, runsByWorkspace = {}, previewPorts = [], dispatchQueue = [], dispatchAllJobs = {}, hostname = "" } = ctx;
  const isGitRepo = ws?.is_git_repo === true;
  const branch = ws?.branch || "";
  const ahead = ws?.ahead || 0;
  const behind = ws?.behind || 0;
  const changedFiles = ws?.changed_files || 0;
  const insertions = ws?.insertions || 0;
  const deletions = ws?.deletions || 0;
  // findPRForBranch/findRunForBranchの戻り値型はマッチ用フィールドのみの狭い形だが、
  // 実際のオブジェクトはnumber/title/status/conclusion等も持つため any 扱いにする。
  const branchPR: any = isGitRepo && wsName ? findPRForBranch(prsByWorkspace[wsName], branch) : null;
  const branchAction: any = isGitRepo && wsName ? findRunForBranch(runsByWorkspace[wsName], branch) : null;
  const visibleBranchAction = isNoticeableRun(branchAction) ? branchAction : null;
  const devServerEntry = wsName
    ? (previewPorts.find((p) => p.workspace === wsName && p.proxy_port) || null)
    : null;
  const dispatchItems = wsName
    ? dispatchQueue.filter((item) => dispatchWorkspaceLabel(item.request) === wsName)
    : [];
  return {
    // wsが見つかっているか。TerminalPane.vueのpaneWorkspaceと同じ「解決済みかどうか」を
    // peek側の初回誤検知ガードに渡すために必要（usePillPeek参照）。
    wsResolved: !!ws,
    isGitRepo,
    branch,
    dirty: ws?.clean === false,
    ahead,
    behind,
    changedFiles,
    insertions,
    deletions,
    hasPr: !!branchPR,
    branchPR,
    hasAction: !!visibleBranchAction,
    branchAction,
    hasDevServer: !!devServerEntry,
    devServerEntry,
    dispatchCount: dispatchItems.length,
    dispatchItems,
    lastCommitMessage: ws?.last_commit_message,
    tooltips: buildInfoPillTooltips({
      name: wsName || "", isGitRepo,
      branch, ahead, behind, hasUpstream: ws?.has_upstream !== false,
      changedFiles, insertions, deletions,
      lastCommitMessage: ws?.last_commit_message,
      devServerEntry, hostname,
      dispatchItems, dispatchAllJobs,
      branchPR, branchAction,
    }),
  };
}

/**
 * サイドバーの表示行を組み立てる。TabBar と同じく autoDiscovered なタブは除外し、
 * 並び順も openTabs のまま（タブバーと一致）にする。
 *
 * InfoPillRow（TerminalPane と同じピル群）をサイドバーの各行にも出すため、判定に必要な
 * 生データ（PR一覧・Actions run一覧・Dev Server検出結果・dispatchキュー）も ctx で受け取り、
 * ここで各タブ分に絞り込む。
 * @param tabs terminalStore.openTabs
 * @param workspaces workspaceStore.allWorkspaces
 */
export function sessionSidebarItems(
  tabs: any[],
  workspaces: any[],
  ctx: {
    tabFlags?: Record<string | number, any>;
    agentStates?: Record<string, string>;
    doneSessions?: Record<string, boolean>;
    phraseNotifySessions?: Record<string, boolean>;
    prsByWorkspace?: Record<string, any[]>;
    runsByWorkspace?: Record<string, any[]>;
    previewPorts?: any[];
    dispatchQueue?: { request: Record<string, any> }[];
    dispatchAllJobs?: Record<string, Record<string, { label?: string }>>;
    hostname?: string;
  } = {},
) {
  const { tabFlags = {}, agentStates = {}, doneSessions = {}, phraseNotifySessions = {} } = ctx;
  return (tabs || [])
    .filter((tab) => !tabFlags[tab.id]?.autoDiscovered)
    .map((tab) => {
      const ws = tab.workspace ? (workspaces || []).find((w) => w.name === tab.workspace) : undefined;
      // worktree行はブランチを下段（session-sidebar-sub）で別表示するため、タイトルは
      // ベース名のみにする（TabItem.vue等の1行表示と異なりここは2行使えるため）。
      // ワークスペース・ジョブいずれにも紐付かないベアターミナルは「[terminal] パス名」の
      // 形式にする（tab.labelはuseTerminalLifecycle.tsが実cwdのディレクトリ名を反映する）。
      const bareTerminalLabel = tab.label ? `[terminal] ${tab.label}` : "[terminal]";
      const label = ws?.worktree ? (ws.worktree_base || ws.name || "") : (tab.workspace || bareTerminalLabel);
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
        agent: agentStateDescriptor(resolveAgentBadgeState(agentStates[tab.sessionId], !!doneSessions[tab.sessionId])),
        phraseNotify: !!phraseNotifySessions[tab.sessionId],
      };
    });
}

/**
 * タブがまだ無いワークスペースの承認待ちdispatchを、通常のセッション行と同じ情報
 * （Branch/Changes/PR/Actions/DevServer/Dispatchの各ピル）で出すための行データ。
 * openTabWorkspaceNamesに含まれるワークスペースは対象外（既にセッション行のピルで足りるため）。
 * @param workspaces workspaceStore.allWorkspaces
 * @param ctx sessionSidebarItemsと同じctx
 */
export function pendingDispatchSidebarItems(
  workspaces: any[],
  openTabWorkspaceNames: Set<string>,
  ctx: Parameters<typeof sessionSidebarItems>[2] = {},
) {
  const { dispatchQueue = [] } = ctx;
  const names = new Set<string>();
  for (const item of dispatchQueue) {
    const wsName = dispatchWorkspaceLabel(item.request);
    if (wsName && !openTabWorkspaceNames.has(wsName)) names.add(wsName);
  }
  return Array.from(names).map((wsName) => {
    const ws = (workspaces || []).find((w) => w.name === wsName);
    const pill = buildPillFields(wsName, ws, ctx);
    return {
      workspace: wsName,
      label: ws?.worktree ? (ws.worktree_base || ws.name || wsName) : wsName,
      wsIcon: ws?.icon ? { name: ws.icon, color: ws.icon_color } : null,
      jobIcon: null,
      isWorktree: !!ws?.worktree,
      // SessionRowContent.vueのagentステータスバッジをそのまま流用し「Pending」を示す。
      agent: { icon: "mdi-inbox-arrow-down-outline", label: "Pending", className: "agent-state-dispatch-pending" },
      phraseNotify: false,
      ...pill,
    };
  });
}
