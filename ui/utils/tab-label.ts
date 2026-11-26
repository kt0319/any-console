import { workspaceDisplayName } from "./worktree.ts";

export function workspaceBranchLabel(
  name: string,
  allWorkspaces: { name?: string; worktree?: boolean; branch?: string }[],
): string {
  const found = allWorkspaces.find((w) => w.name === name);
  if (found?.worktree) return workspaceDisplayName(found);
  if (found?.branch) return `${name} | ${found.branch}`;
  return name;
}

export function tabTitleLabel(
  tab: { workspace?: string | null; jobLabel?: string | null; jobName?: string | null } | undefined,
  allWorkspaces: { name?: string; worktree?: boolean; branch?: string }[],
): string {
  if (!tab) return "";
  const ws = tab.workspace ? workspaceBranchLabel(tab.workspace, allWorkspaces) : "";
  const job = tab.jobLabel || tab.jobName || "";
  return [ws, job].filter(Boolean).join(" | ");
}
