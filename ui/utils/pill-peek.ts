// ピルの値更新時、ピル行を1本の長いピル（PillPeek.vue）に数秒だけ差し替えるための変化検出ロジック。
// TerminalPane（浮遊ピル）とセッションサイドバー行で共用する。

import { isDockerContainerActive } from "./docker.ts";
import { formatStatusCounts } from "./git.ts";

export function trailingItemsSignature(items: { key: string; text: string }[]): Map<string, string> {
  return new Map((items || []).map((it) => [it.key, it.text]));
}

/** 前回シグネチャから追加・変化した項目を全件、items の並び順で返す（キューで順に見せるため）。 */
export function findChangedTrailingItems(
  items: { key: string; text: string }[],
  prevSignature: Map<string, string>,
): { key: string; text: string }[] {
  return (items || []).filter((it) => prevSignature.get(it.key) !== it.text);
}

/**
 * 比較元シグネチャを更新する。今回の items に無いキーは再出現時に比較するため残し、
 * 再同期中でない時に直前の items から消えたキーだけ捨てる。
 */
export function mergeVanishedTrailingKeys(
  prev: Map<string, string>,
  next: Map<string, string>,
  prevItemKeys: Set<string>,
  resyncing: boolean,
): Map<string, string> {
  const merged = new Map(next);
  for (const [key, value] of prev) {
    if (next.has(key)) continue;
    if (resyncing || !prevItemKeys.has(key)) merged.set(key, value);
  }
  return merged;
}

/**
 * ピル群共通の trailingPeekItems を組み立てる。各キーは InfoPillRow のボタンの v-if 条件と揃えること
 * （揃えないと非表示ピルの変化が枠を奪い、表示中の別ピルが peek されない）。
 */
export function buildTrailingPeekItems(
  fields: {
    workspaceLabel?: string;
    isGitRepo?: boolean;
    hasSession?: boolean;
    hasWorkspace?: boolean;
    isDirty?: boolean;
    changedFiles?: number;
    insertions?: number;
    deletions?: number;
    statusCounts?: Record<string, number>;
    branch?: string;
    ahead?: number;
    behind?: number;
    branchPR?: { number: number; title: string } | null;
    branchAction?: { id: string | number; status: string; conclusion: string } | null;
    devServerEntry?: { proxy_port: number } | null;
    dockerContainers?: { name?: string; state?: string }[];
    issuesCount?: number;
    dispatchItems?: { id: string }[];
  },
  infoPillConfig: Record<string, boolean>,
): { key: string; text: string }[] {
  const {
    workspaceLabel = "",
    isGitRepo = false,
    hasSession = false,
    hasWorkspace = false,
    isDirty = false,
    changedFiles = 0,
    insertions = 0,
    deletions = 0,
    statusCounts = {},
    branch = "",
    ahead = 0,
    behind = 0,
    branchPR = null,
    branchAction = null,
    devServerEntry = null,
    dockerContainers = [],
    issuesCount = 0,
    dispatchItems = [],
  } = fields || {};
  const items: { key: string; text: string }[] = [];
  items.push({ key: "workspace", text: workspaceLabel });
  if ((isGitRepo || hasSession) && infoPillConfig.files) {
    items.push({ key: "files", text: "Files" });
  }
  if (isGitRepo && isDirty && infoPillConfig.changes) {
    const statuses = formatStatusCounts(statusCounts);
    items.push({ key: "changes", text: [statuses, `+${insertions}`, `-${deletions}`].filter(Boolean).join(" ") });
  }
  if (isGitRepo && infoPillConfig.branch) {
    items.push({ key: "branch", text: `${branch}:${ahead}:${behind}` });
  }
  if (branchPR && infoPillConfig.prs) {
    items.push({ key: "prs", text: `${branchPR.number}:${branchPR.title}` });
  }
  if (branchAction && infoPillConfig.actions) {
    items.push({ key: "actions", text: `${branchAction.id}:${branchAction.status}:${branchAction.conclusion}` });
  }
  if (devServerEntry && infoPillConfig.devserver) {
    items.push({ key: "devserver", text: `Server:${devServerEntry.proxy_port}` });
  }
  const activeDockerContainers = dockerContainers.filter((c) => isDockerContainerActive(c.state));
  if (activeDockerContainers.length > 0 && infoPillConfig.docker) {
    items.push({ key: "docker", text: `Docker:${activeDockerContainers.map((c) => c.name).join(",")}` });
  }
  if (issuesCount > 0 && infoPillConfig.issues) {
    items.push({ key: "issues", text: `Issues:${issuesCount}` });
  }
  if (!hasWorkspace && hasSession && infoPillConfig.add) {
    items.push({ key: "add", text: "Add" });
  }
  if (dispatchItems.length > 0 && infoPillConfig.dispatch) {
    items.push({ key: "dispatch", text: dispatchItems.map((i) => i.id).join(",") });
  }
  return items;
}

/** peekingKeyごとの表示テキスト。changes/branch は複数トーンの色分けのため呼び出し側で組み立てるので対象外。 */
export function buildPeekText(
  peekingKey: string | null,
  fields: {
    workspaceLabel?: string;
    jobLabel?: string;
    branchPR?: { number: number; title: string } | null;
    branchAction?: { name?: string; status: string; conclusion: string } | null;
    devServerEntry?: { proxy_port: number } | null;
    dockerContainers?: { name?: string; state?: string }[];
    issuesCount?: number;
    dispatchTooltip?: string;
  },
): string {
  const {
    workspaceLabel = "",
    jobLabel = "",
    branchPR = null,
    branchAction = null,
    devServerEntry = null,
    dockerContainers = [],
    issuesCount = 0,
    dispatchTooltip = "",
  } = fields || {};
  switch (peekingKey) {
    case "files": return "Files";
    case "prs": return branchPR ? `#${branchPR.number} ${branchPR.title}` : "";
    case "actions": return branchAction
      ? `[${branchAction.name}] ${branchAction.conclusion || branchAction.status}`
      : "";
    case "devserver": return devServerEntry ? `Dev Server :${devServerEntry.proxy_port}` : "Server";
    case "devserver-stop": return "Dev Server Stop";
    case "docker": {
      const active = dockerContainers.filter((c) => isDockerContainerActive(c.state));
      return active.length ? `Docker: ${active.map((c) => c.name).join(", ")}` : "Docker";
    }
    case "issues": return issuesCount > 0 ? `GitHub Issues: ${issuesCount} open` : "GitHub Issues";
    case "add": return "Add";
    case "dispatch": return dispatchTooltip;
    case "workspace": return workspaceLabel;
    case "job": return jobLabel;
    default: return "";
  }
}

/** peekピルの内容が変化した時だけ再測定するための比較用シグネチャ。changes/branch は独自表示のため元データから組み立てる。 */
export function buildPeekSignature(
  peekingKey: string | null,
  fields: Parameters<typeof buildPeekText>[1] & { changedFiles?: number; insertions?: number; deletions?: number; statusCounts?: Record<string, number>; branch?: string; ahead?: number; behind?: number },
): string | null {
  if (!peekingKey) return null;
  const { changedFiles = 0, insertions = 0, deletions = 0, statusCounts = {}, branch = "", ahead = 0, behind = 0 } = fields || {};
  if (peekingKey === "changes") {
    const statuses = formatStatusCounts(statusCounts);
    return `changes:${changedFiles}:${insertions}:${deletions}${statuses ? `:${statuses}` : ""}`;
  }
  if (peekingKey === "branch") return `branch:${branch}:${ahead}:${behind}`;
  return `${peekingKey}:${buildPeekText(peekingKey, fields)}`;
}
