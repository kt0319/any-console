export function buildWebSocketUrl(proto, host, sessionId, cols, rows) {
  let url = `${proto}//${host}/terminal/ws/${sessionId}`;
  if (cols && rows) {
    url += `?cols=${cols}&rows=${rows}`;
  }
  return url;
}
