import { workspaceDisplayName } from "./worktree.ts";

/**
 * ワークスペース名にブランチ名を付与した表示用ラベルを返す。
 * worktree の場合は「ベース名 | ブランチ」、通常のワークスペースは「名前 | ブランチ」形式にする。
 */
export function workspaceBranchLabel(
  name: string,
  allWorkspaces: { name?: string; worktree?: boolean; branch?: string }[],
): string {
  const found = allWorkspaces.find((w) => w.name === name);
  if (found?.worktree) return workspaceDisplayName(found);
  if (found?.branch) return `${name} | ${found.branch}`;
  return name;
}

/**
 * タブの「ワークスペース名 | ブランチ | ジョブ名」表示ラベルを返す。
 */
export function tabTitleLabel(
  tab: { workspace?: string | null; jobLabel?: string | null; jobName?: string | null } | undefined,
  allWorkspaces: { name?: string; worktree?: boolean; branch?: string }[],
): string {
  if (!tab) return "";
  const ws = tab.workspace ? workspaceBranchLabel(tab.workspace, allWorkspaces) : "";
  const job = tab.jobLabel || tab.jobName || "";
  return [ws, job].filter(Boolean).join(" | ");
}
