// Dispatch リクエスト（/dispatch API の request payload）の表示用ラベル。
// Dispatch Queue 一覧（pending / recent）とターミナルのDispatchピルの両方で
// 同じ解決規則を使う。

import { TERMINAL_JOB_KEY } from "./constants.js";

/**
 * 表示・照合に使うワークスペース名。worktree 実行時はサーバが解決した
 * effective_workspace（例: "ws [feature/x]"）を優先する。
 * @param {{effective_workspace?: string, workspace?: string} | null | undefined} request
 * @returns {string}
 */
export function dispatchWorkspaceLabel(request) {
  return request?.effective_workspace || request?.workspace || "";
}

/**
 * 一覧に出すジョブ名。既定ジョブ（terminal）は表示しない（空文字）。
 * @param {{job?: string} | null | undefined} request
 * @returns {string}
 */
export function dispatchJobLabel(request) {
  const job = request?.job;
  return job && job !== TERMINAL_JOB_KEY ? job : "";
}
