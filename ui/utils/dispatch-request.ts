// Dispatch リクエストの表示用ラベル。Queue 一覧とターミナルの Dispatch ピルで同じ解決規則を使う。

import { TERMINAL_JOB_KEY } from "./constants.ts";
import { baseWorkspaceName } from "./worktree.ts";

/** 表示・照合に使うワークスペース名。worktree 実行時はサーバが解決した effective_workspace を優先する。 */
export function dispatchWorkspaceLabel(request: { effective_workspace?: string, workspace?: string } | null | undefined): string {
  return request?.effective_workspace || request?.workspace || "";
}

/**
 * dispatch履歴（recent）をworktreeと元のディレクトリで共有表示するための照合用ラベル。
 * 比較する側（現在のワークスペース名）にも同じく baseWorkspaceName を通すこと。
 */
export function dispatchBaseWorkspaceLabel(request: { effective_workspace?: string, workspace?: string } | null | undefined): string {
  return baseWorkspaceName(dispatchWorkspaceLabel(request));
}

/** 一覧に出すジョブ名（ジョブ定義のキー）。既定ジョブ（terminal）は空文字。表示用labelは resolveDispatchJobLabel を使う。 */
export function dispatchJobLabel(request: { job?: string } | null | undefined): string {
  const job = request?.job;
  return job && job !== TERMINAL_JOB_KEY ? job : "";
}

export function dispatchBranchLabel(request: { branch?: string } | null | undefined): string {
  return request?.branch || "";
}

/**
 * ジョブの表示用label（allJobs = `/jobs/workspaces` のレスポンス）を解決する。
 * ジョブ未指定・allJobs未取得で引けない場合は空文字（キーをそのまま表示しない）。
 */
export function resolveDispatchJobLabel(
  request: { job?: string, workspace?: string } | null | undefined,
  allJobs: Record<string, Record<string, { label?: string }>> | null | undefined,
): string {
  const jobKey = dispatchJobLabel(request);
  if (!jobKey) return "";
  // ジョブ定義は元のワークスペース名（worktreeはそのベース）単位で保持される。
  // effective_workspace は表示用の疑似名でallJobsのキーと一致しないため request.workspace を使う。
  const ws = request?.workspace || "";
  return allJobs?.[ws]?.[jobKey]?.label || "";
}

/** direct スコープのトークンで承認なしに実行された履歴項目（auth は `direct:<トークン名>`）。 */
export function isDirectRun(item: { auth?: string } | null | undefined): boolean {
  return !!item?.auth?.startsWith("direct:");
}
