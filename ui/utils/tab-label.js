import { workspaceDisplayName, worktreeBranchLabel } from "./worktree.js";

/**
 * ワークスペース名にブランチ名を付与した表示用ラベルを返す。
 * worktree の場合は「ベース名 [ブランチ]」、通常のワークスペースは「名前 [ブランチ]」形式にする。
 * @param {string} name
 * @param {{ name?: string, worktree?: boolean, branch?: string }[]} allWorkspaces
 * @returns {string}
 */
export function workspaceBranchLabel(name, allWorkspaces) {
  const found = allWorkspaces.find((w) => w.name === name);
  if (found?.worktree) return workspaceDisplayName(found);
  if (found?.branch) return `${name} ${worktreeBranchLabel(found.branch)}`;
  return name;
}

/**
 * タブの「ワークスペース名 [ブランチ] / ジョブ名」表示ラベルを返す。
 * @param {{ workspace?: string | null, jobLabel?: string | null, jobName?: string | null } | undefined} tab
 * @param {{ name?: string, worktree?: boolean, branch?: string }[]} allWorkspaces
 * @returns {string}
 */
export function tabTitleLabel(tab, allWorkspaces) {
  if (!tab) return "";
  const ws = tab.workspace ? workspaceBranchLabel(tab.workspace, allWorkspaces) : "";
  const job = tab.jobLabel || tab.jobName || "";
  return [ws, job].filter(Boolean).join(" / ");
}
