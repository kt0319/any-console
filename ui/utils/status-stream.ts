import { reconnectBackoffDelay } from "./backoff.ts";
import { EP_WORKSPACES_STATUSES_WS } from "./endpoints.ts";

/**
 * ステータスストリーム WS の URL を組み立てる。
 * @param proto "ws:" | "wss:"
 * @param host location.host
 */
export function buildStatusStreamUrl(proto: string, host: string): string {
  return `${proto}//${host}${EP_WORKSPACES_STATUSES_WS}`;
}

/**
 * parseStatusStreamMessage の返り値（種別ごとの正規化オブジェクト）。
 */
export type StatusStreamMessage =
  | { type: "statuses"; statuses: Record<string, any>[] }
  | { type: "agent_states"; states: { session_id: string; state: string }[] }
  | { type: "dispatch_queue"; items: { id: string; request: Record<string, any> }[]; recent: { id: string; request: Record<string, any>; outcome: string }[] }
  | { type: "phrase_notify"; session_id: string; phrase: string; workspace: string | null }
  | { type: "phrase_notify_clear"; session_id: string }
  | { type: "session_created" | "session_removed"; session_id: string }
  | { type: "session_workspace_bound"; session_id: string; workspace: string }
  | { type: "session_job_bound"; session_id: string; job_name: string; job_label: string; icon: string | null; icon_color: string | null };

/**
 * 受信メッセージをパースして種別ごとの正規化オブジェクトを返す。
 * - statuses: `{ type: "statuses", statuses: [...] }`
 * - agent_states: `{ type: "agent_states", states: [{ session_id, state }] }`
 * - dispatch_queue: `{ type: "dispatch_queue", items: [{ id, request }], recent: [{ id, request, outcome }] }`
 *   （items: pendingの全量スナップショット、recent: 直近に実行/破棄された項目。新しい順）
 * - phrase_notify: `{ type: "phrase_notify", session_id, phrase, workspace }`
 * - phrase_notify_clear: `{ type: "phrase_notify_clear", session_id }`
 * - session_created / session_removed: `{ type, session_id }`（ターミナルセッションの
 *   作成・削除。他クライアントでの変更をタブ一覧へ即時反映するためのnudge、server/src/session_watch.rs）
 * - session_workspace_bound: `{ type, session_id, workspace }`（素のターミナルが
 *   cwd照合で自動ワークスペース紐付けされた通知、server/src/agent_watch.rs apply_workspace_tag）
 * - session_job_bound: `{ type, session_id, job_name, job_label, icon, icon_color }`（素の
 *   ターミナルが前面ジョブのargv照合で自動ジョブタグ付けされた通知、
 *   server/src/agent_watch.rs apply_job_tag。icon/icon_colorは無ければnull）
 * ping・不正 JSON・形式違いは null を返す（呼び出し側は無視すればよい）。
 */
export function parseStatusStreamMessage(raw: unknown): StatusStreamMessage | null {
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
    return { type: "dispatch_queue", items: msg.items, recent: Array.isArray(msg.recent) ? msg.recent : [] };
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
  if (msg.type === "session_workspace_bound" && typeof msg.session_id === "string" && typeof msg.workspace === "string") {
    return { type: "session_workspace_bound", session_id: msg.session_id, workspace: msg.workspace };
  }
  if (
    msg.type === "session_job_bound" && typeof msg.session_id === "string"
    && typeof msg.job_name === "string" && typeof msg.job_label === "string"
  ) {
    return {
      type: "session_job_bound",
      session_id: msg.session_id,
      job_name: msg.job_name,
      job_label: msg.job_label,
      icon: typeof msg.icon === "string" ? msg.icon : null,
      icon_color: typeof msg.icon_color === "string" ? msg.icon_color : null,
    };
  }
  return null;
}

/**
 * サーバへ現在の閲覧セッションを伝える送信メッセージを組み立てる
 * （server/src/status_stream.rs の ClientMessage::Viewing と対応するワイヤ契約）。
 */
export function buildViewingMessage(sessionId: string | null): string {
  return JSON.stringify({ type: "viewing", session_id: sessionId });
}

/**
 * 再接続バックオフ遅延（attempt は 0 始まり）。ターミナル WS と同じ計算を共有する。
 */
export function statusStreamReconnectDelay(attempt: number): number {
  return reconnectBackoffDelay(attempt);
}
