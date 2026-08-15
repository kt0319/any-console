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
 */
export function dispatchJobLabel(request: { job?: string } | null | undefined): string {
  const job = request?.job;
  return job && job !== TERMINAL_JOB_KEY ? job : "";
}
