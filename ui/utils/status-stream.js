import {
  RECONNECT_BACKOFF_BASE_MS,
  RECONNECT_BACKOFF_MULTIPLIER,
  RECONNECT_BACKOFF_MAX,
} from "./constants.js";
import { EP_WORKSPACES_STATUSES_WS } from "./endpoints.js";

/**
 * ステータスストリーム WS の URL を組み立てる。
 * @param {string} proto "ws:" | "wss:"
 * @param {string} host location.host
 * @returns {string}
 */
export function buildStatusStreamUrl(proto, host) {
  return `${proto}//${host}${EP_WORKSPACES_STATUSES_WS}`;
}

/**
 * 受信メッセージをパースして種別ごとの正規化オブジェクトを返す。
 * - statuses: `{ type: "statuses", statuses: [...] }`
 * - hello（接続直後のサーバ環境通知）: `{ type: "hello", watching: boolean }`
 * ping・不正 JSON・形式違いは null を返す（呼び出し側は無視すればよい）。
 * @param {unknown} raw
 * @returns {{ type: "statuses", statuses: Record<string, any>[] } | { type: "hello", watching: boolean } | null}
 */
export function parseStatusStreamMessage(raw) {
  if (typeof raw !== "string") return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg.type !== "string") return null;
  if (msg.type === "statuses" && Array.isArray(msg.statuses)) {
    return { type: "statuses", statuses: msg.statuses };
  }
  if (msg.type === "hello") {
    return { type: "hello", watching: msg.watching === true };
  }
  return null;
}

/**
 * 再接続バックオフ遅延（attempt は 0 始まり）。ターミナル WS と同じ定数系を使う。
 * @param {number} attempt
 * @returns {number}
 */
export function statusStreamReconnectDelay(attempt) {
  const delay = RECONNECT_BACKOFF_BASE_MS * Math.pow(RECONNECT_BACKOFF_MULTIPLIER, attempt);
  return Math.min(delay, RECONNECT_BACKOFF_MAX);
}
