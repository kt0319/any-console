import { useWorkspaceStore } from "../stores/workspace.js";
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
 * git ステータスのリアルタイム配信 WS を購読する。
 * 受信したステータスは workspace ストアへ即時マージされる。
 * 切断時はバックオフ付きで再接続し、その間は既存のポーリングがフォールバックする。
 */
export function useStatusStream() {
  const workspaceStore = useWorkspaceStore();

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
      workspaceStore.statusStreamConnected = true;
      // 切断中の変更を取りこぼしている可能性があるため、接続のたびに全量を同期する
      workspaceStore.fetchStatuses();
    };
    ws.onmessage = (e) => {
      const statuses = parseStatusStreamMessage(e.data);
      if (statuses) workspaceStore.applyStatuses(statuses);
    };
    ws.onclose = () => {
      workspaceStore.statusStreamConnected = false;
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
