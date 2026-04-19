export function buildWebSocketUrl(proto, host, sessionId, token, cols, rows) {
  let url = `${proto}//${host}/terminal/ws/${sessionId}?token=${encodeURIComponent(token)}`;
  if (cols && rows) {
    url += `&cols=${cols}&rows=${rows}`;
  }
  return url;
}
