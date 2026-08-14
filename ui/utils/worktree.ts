/**
 * worktree のブランチ名を安全な表示用文字列として返す（未指定なら空文字）。
 * 単独表示（ワークスペース名パーツと連結しない箇所）用。ベース名と連結して
 * 「ベース名 | ブランチ」にしたい場合は workspaceDisplayName / 呼び出し側で
 * 縦線区切りを付与する。
 */
export function worktreeBranchLabel(branch?: string): string {
  return branch || "";
}

/**
 * worktree 削除の確認ダイアログ・トーストに出す表示名。
 * ワークスペース一覧の worktree エントリ（worktree_branch/name あり）と
 * ブランチ一覧の worktree（branch/path のみ）のどちらを渡しても同じ名前に
 * なるよう、両方のフィールドを順にフォールバックする。
 */
export function worktreeConfirmLabel(wt?: { worktree_branch?: string; branch?: string; name?: string; path?: string }): string {
  return worktreeBranchLabel(wt?.worktree_branch || wt?.branch) || wt?.name || wt?.path || "";
}

/**
 * worktree 削除の確認メッセージ（削除元の画面によらず同一文言にする）。
 * openSessionCount > 0 の時は、削除に伴いそのworktreeを開いているセッションも
 * 閉じることを明示する（findOpenTabsForWorktree の結果件数を渡す）。
 */
export function removeWorktreeConfirmMessage(
  wt?: { worktree_branch?: string; branch?: string; name?: string; path?: string },
  openSessionCount = 0,
): string {
  const base = `Remove worktree "${worktreeConfirmLabel(wt)}"? The working tree directory will be deleted. This cannot be undone.`;
  if (openSessionCount <= 0) return base;
  const sessionsLabel = openSessionCount === 1 ? "session" : "sessions";
  return `${base} Its open ${sessionsLabel} will also be closed.`;
}

/**
 * 削除対象のworktreeを開いているタブを探す。
 * GitChangeBranch.vue経由のwt（gitのworktree一覧、any-console登録名は
 * wt.workspace）とWorkspaceOpen.vue経由のwt（登録済みワークスペースそのもの、
 * 名前はwt.name）の両方の形を受け付ける。
 */
export function findOpenTabsForWorktree<T extends { workspace?: string | null }>(
  tabs: T[],
  wt?: { workspace?: string; name?: string },
): T[] {
  const wsName = wt?.workspace || wt?.name;
  if (!wsName) return [];
  return (tabs || []).filter((tab) => tab.workspace === wsName);
}

/**
 * ワークスペースの表示名を返す。
 * worktree の場合は「ベース名 | ブランチ」形式にする（登録名 base-branch のベタ表示を避ける）。
 */
export function workspaceDisplayName(ws?: { name?: string; worktree?: boolean; worktree_base?: string; worktree_branch?: string }): string {
  if (ws && ws.worktree && ws.worktree_branch) {
    return ws.worktree_base ? `${ws.worktree_base} | ${ws.worktree_branch}` : ws.worktree_branch;
  }
  return (ws && ws.name) || "";
}

/**
 * worktreeのワークスペース名（"base [branch]"形式、server/src/git_utils.rs の
 * worktree_display_name/split_worktree_name と同じ規則）からベースワークスペース名
 * を取り出す。worktreeでなければそのまま返す。
 * dispatch履歴をworktreeと元のディレクトリで共有表示するための正規化に使う
 * （dispatch-request.ts の dispatchBaseWorkspaceLabel 参照）。
 */
export function baseWorkspaceName(name?: string | null): string {
  if (!name || !name.endsWith("]")) return name || "";
  const stripped = name.slice(0, -1);
  const open = stripped.indexOf("[");
  if (open === -1) return name;
  const base = stripped.slice(0, open).trimEnd();
  const branch = stripped.slice(open + 1);
  if (!base || !branch) return name;
  if (!/\s$/.test(stripped.slice(0, open))) return name;
  return base;
}
