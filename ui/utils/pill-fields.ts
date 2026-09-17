import { findPRForBranch, findRunForBranch, isNoticeableRun } from "./github-runs.ts";
import { dispatchWorkspaceLabel } from "./dispatch-request.ts";
import { buildInfoPillTooltips } from "./info-pill-tooltips.ts";
import { isDockerContainerActive } from "./docker.ts";

// Info Pills（TerminalPaneの浮遊ピル・セッションサイドバー行）の表示値を組み立てる純粋関数群。
// 両者が同じ関数を通すことで、同じワークスペースなら同じピルが同じ内容・同じpeek対象になる。

export type PillFieldsContext = {
  prsByWorkspace?: Record<string, any[]>;
  runsByWorkspace?: Record<string, any[]>;
  previewPorts?: any[];
  dockerContainers?: any[];
  issuesByWorkspace?: Record<string, any[]>;
  dispatchQueue?: { request: Record<string, any> }[];
  dispatchAllJobs?: Record<string, Record<string, { label?: string }>>;
  hostname?: string;
};

/**
 * InfoPillRow用の派生フィールド（Branch/Changes/PR/Actions/DevServer/Docker/Issues/Dispatch）を
 * ワークスペース名単位でまとめて計算する。
 * @param ws workspaceStore.allWorkspaces の該当エントリ（無ければ undefined）
 * @param tooltipName ツールチップに出す名前（ワークスペース未紐付けのターミナルでは呼び出し側の表示名）
 */
export function buildPillFields(
  wsName: string | null | undefined,
  ws: any,
  ctx: PillFieldsContext,
  tooltipName: string = wsName || "",
) {
  const { prsByWorkspace = {}, runsByWorkspace = {}, previewPorts = [], dockerContainers = [], issuesByWorkspace = {}, dispatchQueue = [], dispatchAllJobs = {}, hostname = "" } = ctx;
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
  // ワークスペース未紐付けのターミナル同士で workspace===null がマッチしないよう、名前が無ければ対象外。
  const devServerEntry = wsName
    ? (previewPorts.find((p) => p.workspace === wsName && p.proxy_port) || null)
    : null;
  const workspaceDockerContainers = wsName
    ? dockerContainers.filter((c) => c.workspace === wsName)
    : [];
  const dispatchItems = wsName
    ? dispatchQueue.filter((item) => dispatchWorkspaceLabel(item.request) === wsName)
    : [];
  // github/issues はサーバ既定で open のみを返す。
  const issuesCount = isGitRepo && wsName ? (issuesByWorkspace[wsName] || []).length : 0;
  return {
    // wsが見つかっているか。peek側の初回誤検知ガードに渡す（usePillPeek参照）。
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
    hasDocker: workspaceDockerContainers.some((c) => isDockerContainerActive(c.state)),
    dockerContainers: workspaceDockerContainers,
    issuesCount,
    dispatchCount: dispatchItems.length,
    dispatchItems,
    lastCommitMessage: ws?.last_commit_message,
    tooltips: buildInfoPillTooltips({
      name: tooltipName, isGitRepo,
      branch, ahead, behind, hasUpstream: ws?.has_upstream !== false,
      changedFiles, insertions, deletions,
      lastCommitMessage: ws?.last_commit_message,
      devServerEntry, hostname,
      dockerContainers: workspaceDockerContainers,
      issuesCount,
      dispatchItems, dispatchAllJobs,
      branchPR, branchAction,
    }),
  };
}

export type PillFields = ReturnType<typeof buildPillFields>;

/**
 * peek（値の変化を1本の長いピルで数秒見せる）の変化検出・表示に使うフィールド。
 * actionsは成功完了の瞬間もpeekで知らせたいため、フィルタ前のbranchActionを使う。
 * branchは画面回転で変わる省略表示ではなく生のブランチ名を使う（回転だけで誤検知しないため）。
 */
export function buildPeekFields(
  tab: { workspace?: string | null; label?: string | null; sessionId?: string | null },
  pill: PillFields,
) {
  return {
    workspaceLabel: tab.workspace || tab.label || "",
    isGitRepo: pill.isGitRepo,
    hasSession: !!tab.sessionId,
    hasWorkspace: !!tab.workspace,
    isDirty: pill.dirty,
    changedFiles: pill.changedFiles,
    insertions: pill.insertions,
    deletions: pill.deletions,
    branch: pill.branch,
    ahead: pill.ahead,
    behind: pill.behind,
    lastCommitMessage: pill.lastCommitMessage,
    branchPR: pill.branchPR,
    branchAction: pill.branchAction,
    devServerEntry: pill.devServerEntry,
    dockerContainers: pill.dockerContainers,
    issuesCount: pill.issuesCount,
    dispatchItems: pill.dispatchItems,
    dispatchTooltip: pill.tooltips.dispatch,
  };
}
