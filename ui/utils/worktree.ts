/** worktree のブランチ名を単独表示用に返す（未指定なら空文字）。 */
export function worktreeBranchLabel(branch?: string): string {
  return branch || "";
}

/**
 * worktree 削除の確認ダイアログ・トースト用の表示名。
 * worktree_branch/name と branch/path のどちらの形でも同じ名前になるようフォールバックする。
 */
export function worktreeConfirmLabel(wt?: { worktree_branch?: string; branch?: string; name?: string; path?: string }): string {
  return worktreeBranchLabel(wt?.worktree_branch || wt?.branch) || wt?.name || wt?.path || "";
}

/**
 * worktree 削除に伴って閉じる/停止する残骸（開いているセッション・dev server）を説明する一文。該当が無ければ空文字。
 */
export function worktreeResidueNote(
  residue: { openTabs?: number; detachedSessions?: number; devServers?: number } = {},
): string {
  const sessionCount = (residue.openTabs || 0) + (residue.detachedSessions || 0);
  const parts: string[] = [];
  if (sessionCount > 0) {
    parts.push(`Its open ${sessionCount === 1 ? "session" : "sessions"} will also be closed.`);
  }
  if (residue.devServers) {
    parts.push(`Its ${residue.devServers === 1 ? "dev server process" : `${residue.devServers} dev server processes`} will also be stopped.`);
  }
  return parts.join(" ");
}

/** worktree 削除の確認メッセージ。residue は findResidue() の結果件数。 */
export function removeWorktreeConfirmMessage(
  wt?: { worktree_branch?: string; branch?: string; name?: string; path?: string },
  residue: { openTabs?: number; detachedSessions?: number; devServers?: number } = {},
): string {
  const base = `Remove worktree "${worktreeConfirmLabel(wt)}"? The working tree directory will be deleted. This cannot be undone.`;
  const note = worktreeResidueNote(residue);
  return note ? `${base} ${note}` : base;
}

/**
 * 削除対象の worktree を開いているタブを探す。wt.workspace（git worktree 一覧由来）と wt.name（登録済みワークスペース由来）の両形を受け付ける。
 */
export function findOpenTabsForWorktree<T extends { workspace?: string | null }>(
  tabs: T[],
  wt?: { workspace?: string; name?: string },
): T[] {
  const wsName = wt?.workspace || wt?.name;
  if (!wsName) return [];
  return (tabs || []).filter((tab) => tab.workspace === wsName);
}

/** ワークスペースの表示名。worktree は「ベース名 | ブランチ」形式。 */
export function workspaceDisplayName(ws?: { name?: string; worktree?: boolean; worktree_base?: string; worktree_branch?: string }): string {
  if (ws && ws.worktree && ws.worktree_branch) {
    return ws.worktree_base ? `${ws.worktree_base} | ${ws.worktree_branch}` : ws.worktree_branch;
  }
  return (ws && ws.name) || "";
}

/**
 * worktree のワークスペース名（"base:branch"、server/src/git_utils.rs の worktree_workspace_name と同じ規則）からベース名を取り出す。
 * worktree でなければそのまま返す。
 */
export function baseWorkspaceName(name?: string | null): string {
  if (!name) return "";
  const idx = name.indexOf(":");
  if (idx === -1) return name;
  const base = name.slice(0, idx);
  const branch = name.slice(idx + 1);
  if (!base || !branch) return name;
  return base;
}

/**
 * 新しいタブを置く位置。worktree のタブは同じベースの最後のタブの隣、ベースのタブは同じワークスペースの最後の隣
 * （worktree のタブだけならその先頭の左）。同じベースのタブが無ければ末尾。
 */
export function tabInsertIndex(tabs: { workspace?: string | null }[], workspace?: string | null): number {
  const base = baseWorkspaceName(workspace);
  if (!base) return tabs.length;
  const sameBase = (i: number) => baseWorkspaceName(tabs[i].workspace) === base;
  if (base === workspace) {
    for (let i = tabs.length - 1; i >= 0; i--) {
      if (tabs[i].workspace === base) return i + 1;
    }
    const firstWorktree = tabs.findIndex((_, i) => sameBase(i));
    return firstWorktree === -1 ? tabs.length : firstWorktree;
  }
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (sameBase(i)) return i + 1;
  }
  return tabs.length;
}

/**
 * baseWorkspaceName の逆。ベース名とブランチ名から "base:branch" を組み立てる（server/src/git_utils.rs と同じ規則）。
 * `/worktrees` API 由来のエントリは workspace/name を持たないため、findOpenTabsForWorktree に渡す前に必要。
 */
export function worktreeWorkspaceName(base?: string | null, branch?: string | null): string {
  if (!base || !branch) return "";
  return `${base}:${branch}`;
}

/**
 * 並び順を保ったまま、同じベースワークスペースが連続するタブを1グループにまとめる。
 * ワークスペース未紐付けのタブは常に単独のグループになる。
 */
export function groupTabsByBaseWorkspace<T extends { tab: { id?: number; workspace?: string | null } }>(
  items: T[],
): { key: string; items: T[] }[] {
  const groups: { key: string; base: string; items: T[] }[] = [];
  for (const item of items) {
    const base = baseWorkspaceName(item.tab.workspace);
    const last = groups[groups.length - 1];
    if (base && last && last.base === base) {
      last.items.push(item);
    } else {
      groups.push({ key: `${base}#${item.tab.id}`, base, items: [item] });
    }
  }
  return groups.map(({ key, items: grouped }) => ({ key, items: grouped }));
}
