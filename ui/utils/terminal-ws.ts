export function buildWebSocketUrl(
  proto: string,
  host: string,
  sessionId: string,
  cols?: number | null,
  rows?: number | null,
): string {
  let url = `${proto}//${host}/terminal/ws/${sessionId}`;
  if (cols && rows) {
    url += `?cols=${cols}&rows=${rows}`;
  }
  return url;
}

/**
 * 再接続オーバーレイのラベルを組み立てる。
 * "Reconnecting" だけでは何が起きているか分からないため、理由を括弧で補足する。
 * reason 例: "resume"（バックグラウンド復帰）/ "stale"（半開き接続の検知）/ "retry 2"（切断後の再試行回数）。
 */
export function buildReconnectLabel(reason: string | null | undefined): string {
  return reason ? `Reconnecting (${reason})` : "Reconnecting";
}
