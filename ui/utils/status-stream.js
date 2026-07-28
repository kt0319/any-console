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
 * - agent_states: `{ type: "agent_states", states: [{ session_id, state }] }`
 * - dispatch_queue: `{ type: "dispatch_queue", items: [{ id, request }] }`（全量スナップショット）
 * - phrase_notify: `{ type: "phrase_notify", session_id, phrase, workspace }`
 * - phrase_notify_clear: `{ type: "phrase_notify_clear", session_id }`
 * - session_created / session_removed: `{ type, session_id }`（ターミナルセッションの
 *   作成・削除。他クライアントでの変更をタブ一覧へ即時反映するためのnudge、api/session_watch.py）
 * ping・不正 JSON・形式違いは null を返す（呼び出し側は無視すればよい）。
 * @param {unknown} raw
 * @returns {{ type: "statuses", statuses: Record<string, any>[] }
 *   | { type: "agent_states", states: { session_id: string, state: string }[] }
 *   | { type: "dispatch_queue", items: { id: string, request: Record<string, any> }[] }
 *   | { type: "phrase_notify", session_id: string, phrase: string, workspace: string | null }
 *   | { type: "phrase_notify_clear", session_id: string }
 *   | { type: "session_created" | "session_removed", session_id: string }
 *   | null}
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
  if (msg.type === "agent_states" && Array.isArray(msg.states)) {
    return { type: "agent_states", states: msg.states };
  }
  if (msg.type === "dispatch_queue" && Array.isArray(msg.items)) {
    return { type: "dispatch_queue", items: msg.items };
  }
  if (msg.type === "phrase_notify" && typeof msg.session_id === "string") {
    return { type: "phrase_notify", session_id: msg.session_id, phrase: msg.phrase ?? "", workspace: msg.workspace ?? null };
  }
  if (msg.type === "phrase_notify_clear" && typeof msg.session_id === "string") {
    return { type: "phrase_notify_clear", session_id: msg.session_id };
  }
  if ((msg.type === "session_created" || msg.type === "session_removed") && typeof msg.session_id === "string") {
    return { type: msg.type, session_id: msg.session_id };
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
