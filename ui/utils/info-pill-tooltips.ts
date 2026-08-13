// Info Pills のツールチップ文言（純粋関数）。アイコンのみのボタンでも、
// PCでホバーした時にその時点の実際の値（ブランチ名・変更行数・Dev Serverの
// 接続先）が data-tooltip でわかるようにする。固定の説明文言だけだと、
// 展開しないと現在値を確認できないため。

import { firstCommitLine } from "./git.ts";
import { devServerOrigin } from "./preview-url.ts";
import { dispatchJobLabel } from "./dispatch-request.ts";

export function branchTooltip({ branch = "", ahead = 0, behind = 0, hasUpstream = true }: {
  branch?: string; ahead?: number; behind?: number; hasUpstream?: boolean;
}): string {
  const parts: string[] = [];
  if (ahead > 0) parts.push(`${ahead} to push`);
  if (behind > 0) parts.push(`${behind} to pull`);
  if (!hasUpstream) parts.push("no upstream");
  return parts.length ? `Branches: ${branch} (${parts.join(", ")})` : `Branches: ${branch}`;
}

/**
 * Filesピルはワークスペースピルと統合したため、ワークスペース名も併記する。
 */
export function filesTooltip({ name = "", isGitRepo = false }: { name?: string; isGitRepo?: boolean }): string {
  const action = isGitRepo ? "Browse files" : "Browse files in this terminal's directory";
  return name ? `${name}  ·  ${action}` : action;
}

export function changesTooltip({ changedFiles = 0, insertions = 0, deletions = 0 }: {
  changedFiles?: number; insertions?: number; deletions?: number;
}): string {
  return `Changes: ${changedFiles}F +${insertions} -${deletions}`;
}

export function historyTooltip(lastCommitMessage: string | null | undefined): string {
  const msg = firstCommitLine(lastCommitMessage);
  return msg ? `History: ${msg}` : "History";
}

export function devServerTooltip(entry: { scheme?: string; proxy_port?: number } | null | undefined, hostname: string): string {
  if (!entry) return "Dev Server";
  return `Dev Server: ${devServerOrigin(entry, hostname)}`;
}

export function dispatchTooltip(items: { request: Record<string, any> }[]): string {
  if (items.length === 1) {
    return `Dispatch: ${dispatchJobLabel(items[0].request) || "run"}`;
  }
  return items.length ? `Dispatch: ${items.length} pending` : "Dispatch";
}

export function prsTooltip(pr: { number?: number; title?: string } | null | undefined): string {
  return pr ? `GitHub PR #${pr.number}: ${pr.title}` : "GitHub PRs";
}

export function actionsTooltip(run: { name?: string; status?: string; conclusion?: string } | null | undefined): string {
  if (!run) return "GitHub Actions";
  return `GitHub Actions: ${run.name} (${run.conclusion || run.status})`;
}

export const ADD_PILL_TOOLTIP = "Add or open this directory as a workspace";

/**
 * InfoPillRow の tooltips prop（キーごとのツールチップ文言）を一括で組み立てる。
 * TerminalPane.vue（computed）と session-sidebar.js（行データ）が共用する。
 */
export function buildInfoPillTooltips({
  name = "", isGitRepo = false,
  branch = "", ahead = 0, behind = 0, hasUpstream = true,
  changedFiles = 0, insertions = 0, deletions = 0,
  lastCommitMessage = null,
  devServerEntry = null, hostname = "",
  dispatchItems = [],
  branchPR = null, branchAction = null,
}: {
  name?: string; isGitRepo?: boolean;
  branch?: string; ahead?: number; behind?: number; hasUpstream?: boolean;
  changedFiles?: number; insertions?: number; deletions?: number;
  lastCommitMessage?: string | null;
  devServerEntry?: any; hostname?: string;
  dispatchItems?: { request: Record<string, any> }[];
  branchPR?: any; branchAction?: any;
}): Record<string, string> {
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
