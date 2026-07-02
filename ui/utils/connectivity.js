// 接続状態の判定ロジック（純粋関数）。
//
// 設計方針: 実際に依存しているのは端末 WebSocket なので、生存判定の一次情報源を
// WS に置く。HTTP ヘルスチェックは「生きた WS が1本も無い時」だけのフォールバック。
// これにより、サーバが重い処理で一時的に遅い状況を「オフライン」と誤検知しない。

/**
 * タブの WS が「生きている」か。open かつ最近 activity（受信フレーム）があるもの。
 * サーバは idle 時も keepalive フレームを送るため、無音が続く = 半開き接続とみなす。
 * @param {{ ws?: unknown, _wsDisposed?: boolean, _lastWriteAt?: number } | null | undefined} tab
 * @param {number} now performance.now() 相当
 * @param {number} staleMs 無音許容時間
 * @returns {boolean}
 */
export function isTabWsAlive(tab, now, staleMs) {
  if (!tab || !tab.ws || tab._wsDisposed) return false;
  return now - (tab._lastWriteAt || 0) < staleMs;
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
    (t) => t && t.ws && !t._wsDisposed && now - (t._lastWriteAt || 0) >= staleMs,
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
