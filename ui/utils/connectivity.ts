// 接続状態の判定ロジック（純粋関数）。
//
// 設計方針: 実際に依存しているのは端末 WebSocket なので、生存判定の一次情報源を
// WS に置く。HTTP ヘルスチェックは「生きた WS が1本も無い時」だけのフォールバック。
// これにより、サーバが重い処理で一時的に遅い状況を「オフライン」と誤検知しない。

// WebSocket.OPEN。CONNECTING(0)/CLOSING(2)/CLOSED(3) は生存扱いしない。
const WS_READY_STATE_OPEN = 1;

/** 接続判定に必要なタブの部分形状。 */
type TabLike = {
  ws?: { readyState?: number } | null,
  _wsDisposed?: boolean,
  _lastWriteAt?: number,
  _lastSendAt?: number,
};

/**
 * タブ WS の最終 activity 時刻。受信（keepalive 含む）と送信（ユーザー入力）の新しい方。
 * エコー無しプログラム（`read -s` 等）への連続入力で受信が途絶えても、送信を
 * activity として数えることで健全な接続を stale と誤判定しない。
 */
function lastActivityAt(tab: { _lastWriteAt?: number, _lastSendAt?: number }): number {
  return Math.max(tab._lastWriteAt || 0, tab._lastSendAt || 0);
}

/**
 * タブの WS が「生きている」か。readyState=OPEN かつ最近 activity があるもの。
 * サーバは idle 時も keepalive フレームを送るため、無音が続く = 半開き接続とみなす。
 * 握手中(CONNECTING)や切断中(CLOSING)は生存扱いせず、HTTP フォールバックに委ねる。
 * @param now performance.now() 相当
 * @param staleMs 無音許容時間
 */
export function isTabWsAlive(tab: TabLike | null | undefined, now: number, staleMs: number): boolean {
  if (!tab || !tab.ws || tab._wsDisposed) return false;
  if (tab.ws.readyState !== WS_READY_STATE_OPEN) return false;
  return now - lastActivityAt(tab) < staleMs;
}

/**
 * 生きた WS を1本でも持つタブがあるか。
 */
export function anyTabWsAlive(tabs: ReadonlyArray<TabLike>, now: number, staleMs: number): boolean {
  return (tabs || []).some((t) => isTabWsAlive(t, now, staleMs));
}

/**
 * ws は open だが activity が途絶したタブ（半開き接続）。強制再接続の対象。
 */
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

/**
 * 全画面「Connection lost」を出すか（＝真のオフライン）の判定。
 * - ネットワーク断（navigator.onLine=false）は即オフライン。
 * - 生きた WS があれば決してオフラインにしない（一時的なサーバ遅延の誤検知を防ぐ）。
 * - WS が無い時だけ HTTP 失敗回数の閾値で判定する。
 */
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
