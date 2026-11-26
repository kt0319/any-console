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

// reason 例: "resume"（バックグラウンド復帰）/ "stale"（半開き接続の検知）/ "retry 2"（再試行回数）
export function buildReconnectLabel(reason: string | null | undefined): string {
  return reason ? `Reconnecting (${reason})` : "Reconnecting";
}
