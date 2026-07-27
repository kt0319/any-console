import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { applyDispatchQueue } from "./useDispatchConfirm.js";
import { on } from "../app-bridge.js";
import { debugLog } from "./useClientLogs.js";
import {
  buildStatusStreamUrl,
  parseStatusStreamMessage,
  statusStreamReconnectDelay,
} from "../utils/status-stream.js";

// アプリ全体で 1 本の WS を共有するモジュールシングルトン。
let socket = /** @type {WebSocket|null} */ (null);
let reconnectTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
let reconnectAttempts = 0;
let started = false;

/**
 * git ステータス／エージェント状態／dispatch キューのリアルタイム配信 WS を購読する。
 * 受信した git ステータスは workspace ストアへ、エージェント状態は terminal
 * ストアへ即時マージされ、dispatch キューは承認待ち一覧へ全量反映される。
 * 切断時はバックオフ付きで再接続し、再接続のたびに全量を同期して取りこぼしを埋める
 * （エージェント状態・dispatch キューはサーバが購読開始時にスナップショットを送る）。
 */
export function useStatusStream() {
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();

  function isClosed() {
    return !socket || socket.readyState === WebSocket.CLOSED;
  }

  function connect() {
    if (!isClosed() || document.hidden) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(buildStatusStreamUrl(proto, location.host));
    socket = ws;

    ws.onopen = () => {
      debugLog("[StatusStream] connected");
      reconnectAttempts = 0;
      // 切断中の変更を取りこぼしている可能性があるため、接続のたびに全量を同期する
      workspaceStore.fetchStatuses();
    };
    ws.onmessage = (e) => {
      const msg = parseStatusStreamMessage(e.data);
      if (msg?.type === "statuses") {
        workspaceStore.applyStatuses(msg.statuses);
      } else if (msg?.type === "agent_states") {
        terminalStore.applyAgentStates(msg.states);
      } else if (msg?.type === "dispatch_queue") {
        applyDispatchQueue(msg.items);
      } else if (msg?.type === "phrase_notify") {
        terminalStore.markPhraseNotify(msg.session_id);
      }
    };
    ws.onclose = () => {
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = statusStreamReconnectDelay(reconnectAttempts);
    reconnectAttempts += 1;
    debugLog("[StatusStream] reconnect in", delay, "ms");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function reconnectNow() {
    if (!isClosed()) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    connect();
  }

  /** アプリ起動時に一度だけ呼ぶ。 */
  function start() {
    if (started) return;
    started = true;
    connect();
    // バックグラウンド復帰・オンライン復帰は待たずに即再接続する
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) reconnectNow();
    });
    on("connectivity:back", () => reconnectNow());
  }

  return { start };
}
