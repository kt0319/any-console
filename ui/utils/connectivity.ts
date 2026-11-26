// 生存判定の一次情報源は端末 WebSocket。HTTP ヘルスチェックは生きた WS が無い時だけのフォールバックで、
// サーバの一時的な遅延を「オフライン」と誤検知しないための設計。

// WebSocket.OPEN
const WS_READY_STATE_OPEN = 1;

type TabLike = {
  ws?: { readyState?: number } | null,
  _wsDisposed?: boolean,
  _lastWriteAt?: number,
  _lastSendAt?: number,
};

// 送信も activity に数える（エコー無しの入力中に受信が途絶えても stale と誤判定しない）
function lastActivityAt(tab: { _lastWriteAt?: number, _lastSendAt?: number }): number {
  return Math.max(tab._lastWriteAt || 0, tab._lastSendAt || 0);
}

// OPEN かつ最近 activity あり。サーバは idle 時も keepalive を送るため、無音が続けば半開き接続とみなす
export function isTabWsAlive(tab: TabLike | null | undefined, now: number, staleMs: number): boolean {
  if (!tab || !tab.ws || tab._wsDisposed) return false;
  if (tab.ws.readyState !== WS_READY_STATE_OPEN) return false;
  return now - lastActivityAt(tab) < staleMs;
}

export function anyTabWsAlive(tabs: ReadonlyArray<TabLike>, now: number, staleMs: number): boolean {
  return (tabs || []).some((t) => isTabWsAlive(t, now, staleMs));
}

export function staleAliveTabs<T extends TabLike>(tabs: Array<T>, now: number, staleMs: number): Array<T> {
  return (tabs || []).filter(
    (t) =>
      t &&
      t.ws &&
      !t._wsDisposed &&
      t.ws.readyState === WS_READY_STATE_OPEN &&
      now - lastActivityAt(t) >= staleMs,
  );
}

// 生きた WS があれば決してオフラインにしない。WS が無い時だけ HTTP 失敗回数の閾値で判定する
export function decideOffline({ navigatorOnline, anyWsAlive, consecutiveFailures, threshold }: {
  navigatorOnline: boolean,
  anyWsAlive: boolean,
  consecutiveFailures: number,
  threshold: number,
}): boolean {
  if (!navigatorOnline) return true;
  if (anyWsAlive) return false;
  return consecutiveFailures >= threshold;
}
