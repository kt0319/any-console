/**
 * worktree のブランチ名を安全な表示用文字列として返す（未指定なら空文字）。
 * 単独表示（ワークスペース名パーツと連結しない箇所）用。ベース名と連結して
 * 「ベース名 | ブランチ」にしたい場合は workspaceDisplayName / 呼び出し側で
 * 縦線区切りを付与する。
 * @param {string} [branch]
 * @returns {string}
 */
export function worktreeBranchLabel(branch) {
  return branch || "";
}

/**
 * worktree 削除の確認ダイアログ・トーストに出す表示名。
 * ワークスペース一覧の worktree エントリ（worktree_branch/name あり）と
 * ブランチ一覧の worktree（branch/path のみ）のどちらを渡しても同じ名前に
 * なるよう、両方のフィールドを順にフォールバックする。
 * @param {{ worktree_branch?: string, branch?: string, name?: string, path?: string }} [wt]
 * @returns {string}
 */
export function worktreeConfirmLabel(wt) {
  return worktreeBranchLabel(wt?.worktree_branch || wt?.branch) || wt?.name || wt?.path || "";
}

/**
 * worktree 削除の確認メッセージ（削除元の画面によらず同一文言にする）。
 * @param {{ worktree_branch?: string, branch?: string, name?: string, path?: string }} [wt]
 * @returns {string}
 */
export function removeWorktreeConfirmMessage(wt) {
  return `Remove worktree "${worktreeConfirmLabel(wt)}"? The working tree directory will be deleted. This cannot be undone.`;
}

/**
 * ワークスペースの表示名を返す。
 * worktree の場合は「ベース名 | ブランチ」形式にする（登録名 base-branch のベタ表示を避ける）。
 * @param {{ name?: string, worktree?: boolean, worktree_base?: string, worktree_branch?: string }} [ws]
 * @returns {string}
 */
export function workspaceDisplayName(ws) {
  if (ws && ws.worktree && ws.worktree_branch) {
    return ws.worktree_base ? `${ws.worktree_base} | ${ws.worktree_branch}` : ws.worktree_branch;
  }
  return (ws && ws.name) || "";
}
