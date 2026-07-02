// 接続状態の判定ロジック（純粋関数）。
//
// 設計方針: 実際に依存しているのは端末 WebSocket なので、生存判定の一次情報源を
// WS に置く。HTTP ヘルスチェックは「生きた WS が1本も無い時」だけのフォールバック。
// これにより、サーバが重い処理で一時的に遅い状況を「オフライン」と誤検知しない。

// WebSocket.OPEN。CONNECTING(0)/CLOSING(2)/CLOSED(3) は生存扱いしない。
const WS_READY_STATE_OPEN = 1;

/**
 * タブ WS の最終 activity 時刻。受信（keepalive 含む）と送信（ユーザー入力）の新しい方。
 * エコー無しプログラム（`read -s` 等）への連続入力で受信が途絶えても、送信を
 * activity として数えることで健全な接続を stale と誤判定しない。
 * @param {{ _lastWriteAt?: number, _lastSendAt?: number }} tab
 * @returns {number}
 */
function lastActivityAt(tab) {
  return Math.max(tab._lastWriteAt || 0, tab._lastSendAt || 0);
}

/**
 * タブの WS が「生きている」か。readyState=OPEN かつ最近 activity があるもの。
 * サーバは idle 時も keepalive フレームを送るため、無音が続く = 半開き接続とみなす。
 * 握手中(CONNECTING)や切断中(CLOSING)は生存扱いせず、HTTP フォールバックに委ねる。
 * @param {{ ws?: { readyState?: number }, _wsDisposed?: boolean, _lastWriteAt?: number, _lastSendAt?: number } | null | undefined} tab
 * @param {number} now performance.now() 相当
 * @param {number} staleMs 無音許容時間
 * @returns {boolean}
 */
export function isTabWsAlive(tab, now, staleMs) {
  if (!tab || !tab.ws || tab._wsDisposed) return false;
  if (tab.ws.readyState !== WS_READY_STATE_OPEN) return false;
  return now - lastActivityAt(tab) < staleMs;
}

/**
 * 生きた WS を1本でも持つタブがあるか。
 * @param {Array<object>} tabs
 * @param {number} now
 * @param {number} staleMs
 * @returns {boolean}
 */
export function anyTabWsAlive(tabs, now, staleMs) {
  return (tabs || []).some((t) => isTabWsAlive(t, now, staleMs));
}

/**
 * ws は open だが activity が途絶したタブ（半開き接続）。強制再接続の対象。
 * @param {Array<object>} tabs
 * @param {number} now
 * @param {number} staleMs
 * @returns {Array<object>}
 */
export function staleAliveTabs(tabs, now, staleMs) {
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
 * @param {{ navigatorOnline: boolean, anyWsAlive: boolean, consecutiveFailures: number, threshold: number }} args
 * @returns {boolean}
 */
export function decideOffline({ navigatorOnline, anyWsAlive, consecutiveFailures, threshold }) {
  if (!navigatorOnline) return true;
  if (anyWsAlive) return false;
  return consecutiveFailures >= threshold;
}
