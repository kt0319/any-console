// サーバの github_watch へ「どのワークスペースの GitHub 新着を受けたいか」を宣言するための
// 参照カウント付き監視対象と、再接続時の取りこぼし再送に使う最終 seq の管理。
// 同じワークスペースを複数のペイン・行が開いていても、サーバへ伝える対象は1件にまとまる。

const refCounts = new Map<string, number>();
const lastSeqByWorkspace = new Map<string, number>();
const changeListeners = new Set<() => void>();

function notifyChange() {
  for (const listener of changeListeners) listener();
}

export function watchGitHubWorkspace(workspace: string) {
  if (!workspace) return;
  const count = refCounts.get(workspace) || 0;
  refCounts.set(workspace, count + 1);
  if (count === 0) notifyChange();
}

export function unwatchGitHubWorkspace(workspace: string) {
  const count = refCounts.get(workspace) || 0;
  if (count === 0) return;
  if (count > 1) {
    refCounts.set(workspace, count - 1);
    return;
  }
  refCounts.delete(workspace);
  // 見ていない間の出来事を再開時にまとめて通知しないよう、最終 seq は捨てる。
  lastSeqByWorkspace.delete(workspace);
  notifyChange();
}

export function onGitHubWatchChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** server/src/status_stream.rs の ClientMessage::WatchGithub と対応するワイヤ契約。 */
export function buildWatchGitHubMessage(): string {
  const workspaces = [...refCounts.keys()].sort();
  const since: Record<string, number> = {};
  for (const workspace of workspaces) {
    const seq = lastSeqByWorkspace.get(workspace);
    if (seq !== undefined) since[workspace] = seq;
  }
  return JSON.stringify({ type: "watch_github", workspaces, since });
}

/** 受信した seq が未処理なら記録して true（再送と実配信が重なった重複は false）。 */
export function acceptGitHubActivitySeq(workspace: string, seq: number): boolean {
  if (!refCounts.has(workspace) || seq <= (lastSeqByWorkspace.get(workspace) ?? 0)) return false;
  lastSeqByWorkspace.set(workspace, seq);
  return true;
}

/** サーバが追い付けないと伝えた（reset）時に、通知せず基準だけ取り直す。 */
export function rebaseGitHubActivitySeq(workspace: string, seq: number) {
  if (refCounts.has(workspace)) lastSeqByWorkspace.set(workspace, seq);
}

export function resetGitHubWatchForTest() {
  refCounts.clear();
  lastSeqByWorkspace.clear();
  changeListeners.clear();
}
