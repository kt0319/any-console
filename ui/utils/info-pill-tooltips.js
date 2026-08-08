// Info Pills のツールチップ文言（純粋関数）。アイコンのみのボタンでも、
// PCでホバーした時にその時点の実際の値（ブランチ名・変更行数・Dev Serverの
// 接続先）が data-tooltip でわかるようにする。固定の説明文言だけだと、
// 展開しないと現在値を確認できないため。

import { firstCommitLine } from "./git.js";
import { devServerOrigin } from "./preview-url.js";
import { dispatchJobLabel } from "./dispatch-request.js";

/**
 * @param {{branch?: string, ahead?: number, behind?: number, hasUpstream?: boolean}} status
 * @returns {string}
 */
export function branchTooltip({ branch = "", ahead = 0, behind = 0, hasUpstream = true }) {
  const parts = [];
  if (ahead > 0) parts.push(`${ahead} to push`);
  if (behind > 0) parts.push(`${behind} to pull`);
  if (!hasUpstream) parts.push("no upstream");
  return parts.length ? `Branches: ${branch} (${parts.join(", ")})` : `Branches: ${branch}`;
}

/**
 * Filesピルはワークスペースピルと統合したため、ワークスペース名も併記する。
 * @param {{name?: string, isGitRepo?: boolean}} options
 * @returns {string}
 */
export function filesTooltip({ name = "", isGitRepo = false }) {
  const action = isGitRepo ? "Browse files" : "Browse files in this terminal's directory";
  return name ? `${name}  ·  ${action}` : action;
}

/**
 * @param {{changedFiles?: number, insertions?: number, deletions?: number}} numstat
 * @returns {string}
 */
export function changesTooltip({ changedFiles = 0, insertions = 0, deletions = 0 }) {
  return `Changes: ${changedFiles}F +${insertions} -${deletions}`;
}

/**
 * @param {string | null | undefined} lastCommitMessage
 * @returns {string}
 */
export function historyTooltip(lastCommitMessage) {
  const msg = firstCommitLine(lastCommitMessage);
  return msg ? `History: ${msg}` : "History";
}

/**
 * @param {{scheme?: string, proxy_port?: number} | null | undefined} entry
 * @param {string} hostname
 * @returns {string}
 */
export function devServerTooltip(entry, hostname) {
  if (!entry) return "Dev Server";
  return `Dev Server: ${devServerOrigin(entry, hostname)}`;
}

/**
 * @param {{request: Record<string, any>}[]} items
 * @returns {string}
 */
export function dispatchTooltip(items) {
  if (items.length === 1) {
    return `Dispatch: ${dispatchJobLabel(items[0].request) || "run"}`;
  }
  return items.length ? `Dispatch: ${items.length} pending` : "Dispatch";
}

/**
 * @param {{number?: number, title?: string} | null | undefined} pr
 * @returns {string}
 */
export function prsTooltip(pr) {
  return pr ? `GitHub PR #${pr.number}: ${pr.title}` : "GitHub PRs";
}

/**
 * @param {{name?: string, status?: string, conclusion?: string} | null | undefined} run
 * @returns {string}
 */
export function actionsTooltip(run) {
  if (!run) return "GitHub Actions";
  return `GitHub Actions: ${run.name} (${run.conclusion || run.status})`;
}

export const ADD_PILL_TOOLTIP = "Add or open this directory as a workspace";

/**
 * InfoPillRow の tooltips prop（キーごとのツールチップ文言）を一括で組み立てる。
 * TerminalPane.vue（computed）と session-sidebar.js（行データ）が共用する。
 * @param {{
 *   name?: string, isGitRepo?: boolean,
 *   branch?: string, ahead?: number, behind?: number, hasUpstream?: boolean,
 *   changedFiles?: number, insertions?: number, deletions?: number,
 *   lastCommitMessage?: string | null,
 *   devServerEntry?: any, hostname?: string,
 *   dispatchItems?: {request: Record<string, any>}[],
 *   branchPR?: any, branchAction?: any,
 * }} data
 * @returns {Record<string, string>}
 */
export function buildInfoPillTooltips({
  name = "", isGitRepo = false,
  branch = "", ahead = 0, behind = 0, hasUpstream = true,
  changedFiles = 0, insertions = 0, deletions = 0,
  lastCommitMessage = null,
  devServerEntry = null, hostname = "",
  dispatchItems = [],
  branchPR = null, branchAction = null,
}) {
  return {
    files: filesTooltip({ name, isGitRepo }),
    history: historyTooltip(lastCommitMessage),
    changes: changesTooltip({ changedFiles, insertions, deletions }),
    branch: branchTooltip({ branch, ahead, behind, hasUpstream }),
    devserver: devServerTooltip(devServerEntry, hostname),
    dispatch: dispatchTooltip(dispatchItems),
    prs: prsTooltip(branchPR),
    actions: actionsTooltip(branchAction),
    add: ADD_PILL_TOOLTIP,
  };
}
