// Dispatch リクエスト（/dispatch API の request payload）の表示用ラベル。
// Dispatch Queue 一覧（pending / recent）とターミナルのDispatchピルの両方で
// 同じ解決規則を使う。

import { TERMINAL_JOB_KEY } from "./constants.ts";
import { baseWorkspaceName } from "./worktree.ts";

/**
 * 表示・照合に使うワークスペース名。worktree 実行時はサーバが解決した
 * effective_workspace（例: "ws:feature/x"）を優先する。
 */
export function dispatchWorkspaceLabel(request: { effective_workspace?: string, workspace?: string } | null | undefined): string {
  return request?.effective_workspace || request?.workspace || "";
}

/**
 * dispatch履歴（recent）をworktreeと元のディレクトリで共有表示するための
 * 照合用ラベル。dispatchWorkspaceLabel の結果からworktreeのベース名を
 * 取り出す（worktreeでなければdispatchWorkspaceLabelと同じ値）。
 * 比較する側（現在表示中のワークスペース名）にも同じくbaseWorkspaceNameを
 * 通してから突き合わせること。
 */
export function dispatchBaseWorkspaceLabel(request: { effective_workspace?: string, workspace?: string } | null | undefined): string {
  return baseWorkspaceName(dispatchWorkspaceLabel(request));
}

/**
 * 一覧に出すジョブ名。既定ジョブ（terminal）は表示しない（空文字）。
 * 戻り値はジョブ定義のキー（job id相当）であり表示用labelではないため、
 * 人間向け表示には resolveDispatchJobLabel を使うこと。
 */
export function dispatchJobLabel(request: { job?: string } | null | undefined): string {
  const job = request?.job;
  return job && job !== TERMINAL_JOB_KEY ? job : "";
}

/**
 * dispatch先のブランチ名。未指定（branch省略のdispatch）なら空文字。
 */
export function dispatchBranchLabel(request: { branch?: string } | null | undefined): string {
  return request?.branch || "";
}

/**
 * ジョブの表示用label（`allJobs`＝`/jobs/workspaces`のレスポンス、
 * `{ [workspace]: { [jobKey]: { label, ... } } }`）を解決する。
 * ジョブ未指定・allJobsが未取得（起動直後等）でlabelが引けない場合は空文字
 * （job id相当のキーをそのまま表示することは避ける — dispatchJobLabel参照）。
 */
export function resolveDispatchJobLabel(
  request: { job?: string, workspace?: string } | null | undefined,
  allJobs: Record<string, Record<string, { label?: string }>> | null | undefined,
): string {
  const jobKey = dispatchJobLabel(request);
  if (!jobKey) return "";
  // ジョブ定義は元のワークスペース名（worktreeの場合はそのベース）単位で
  // 保持される（buildSessionTabParams等の既存解決と同じくrequest.workspaceを
  // 使う。dispatchWorkspaceLabelのeffective_workspaceは表示用の
  // worktree疑似名であり、allJobsのキーとは一致しない）。
  const ws = request?.workspace || "";
  return allJobs?.[ws]?.[jobKey]?.label || "";
}
