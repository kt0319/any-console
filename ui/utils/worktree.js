/**
 * worktree のブランチ名を縦線区切りにした表示用ラベルを返す。
 * @param {string} [branch]
 * @returns {string}
 */
export function worktreeBranchLabel(branch) {
  return branch ? `| ${branch}` : "";
}

/**
 * ワークスペースの表示名を返す。
 * worktree の場合は「ベース名 | ブランチ」形式にする（登録名 base-branch のベタ表示を避ける）。
 * @param {{ name?: string, worktree?: boolean, worktree_base?: string, worktree_branch?: string }} [ws]
 * @returns {string}
 */
export function workspaceDisplayName(ws) {
  if (ws && ws.worktree && ws.worktree_branch) {
    const label = worktreeBranchLabel(ws.worktree_branch);
    return ws.worktree_base ? `${ws.worktree_base} ${label}` : label;
  }
  return (ws && ws.name) || "";
}
