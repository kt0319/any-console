import { watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { applyDispatchQueue } from "./useDispatchConfirm.ts";
import { useSessionSync } from "./useSessionSync.ts";
import { useToast } from "./useToast.ts";
import { on } from "../app-bridge.js";
import { debugLog } from "./useClientLogs.ts";
import {
  buildStatusStreamUrl,
  buildViewingMessage,
  parseStatusStreamMessage,
  statusStreamReconnectDelay,
} from "../utils/status-stream.ts";

// アプリ全体で 1 本の WS を共有するモジュールシングルトン。
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let started = false;

/**
 * git ステータス／エージェント状態／dispatch キュー／ターミナルセッション作成・削除の
 * リアルタイム配信 WS を購読する。
 * 受信した git ステータスは workspace ストアへ、エージェント状態は terminal
 * ストアへ即時マージされ、dispatch キューは承認待ち一覧へ全量反映される。
 * セッション作成・削除の通知は、他クライアントが開閉したタブをポーリング（最大
 * SESSION_SYNC_INTERVAL_MS の遅延、かつ非表示タブでは停止する）を待たずに即座へ
 * 反映するためのnudgeで、既存の syncSessionsFromServer() をそのまま呼ぶ。
 * 切断時はバックオフ付きで再接続し、再接続のたびに全量を同期して取りこぼしを埋める
 * （エージェント状態・dispatch キューはサーバが購読開始時にスナップショットを送る）。
 */
export function useStatusStream() {
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();
  const { syncSessionsFromServer } = useSessionSync();
  const toast = useToast();

  function isClosed() {
    return !socket || socket.readyState === WebSocket.CLOSED;
  }

  // 今アクティブなタブのsessionId（無ければnull）。タブが非表示（バック
  // グラウンド化）中はnull扱いにする — push通知の「その端末で今そのセッションを
  // 見ているなら送らない」抑制はユーザーが実際に画面を見ている時だけ効かせたい
  // ため（バックグラウンドのタブは「見ている」とみなさない）。
  function currentViewingSessionId() {
    if (document.hidden) return null;
    const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
    return tab?.sessionId || null;
  }

  // サーバ（StatusStreamState）へ現在の閲覧セッションを伝える。接続が無ければ
  // 何もしない（次回接続時のonopenで最新値を送り直す）。
  function sendViewing() {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(buildViewingMessage(currentViewingSessionId()));
  }

  function connect() {
    if (!isClosed() || document.hidden) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(buildStatusStreamUrl(proto, location.host));
    socket = ws;

    ws.onopen = () => {
      debugLog("[StatusStream] connected");
      reconnectAttempts = 0;
      // サーバ側の閲覧レジストリは接続（socket）単位で持つため、再接続の
      // たびに現在値を送り直す必要がある。
      sendViewing();
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
        applyDispatchQueue(msg.items, msg.recent);
      } else if (msg?.type === "phrase_notify") {
        terminalStore.markPhraseNotify(msg.session_id);
      } else if (msg?.type === "phrase_notify_clear") {
        terminalStore.clearPhraseNotify(msg.session_id);
      } else if (msg?.type === "session_created" || msg?.type === "session_removed") {
        syncSessionsFromServer();
      } else if (msg?.type === "session_workspace_bound") {
        // 素のターミナルがcwd照合で自動ワークスペース紐付けされた通知。該当タブが
        // 既に開いていれば、次のポーリングを待たずタブアイコン・ピル（Git/Dev
        // Server等）を即座に更新する（setTabWorkspaceがtab.wsIconと
        // tabWorkspaceVersionを進め、TerminalPane/TabItemの各computedが
        // 再評価される）。
        const tab = terminalStore.openTabs.find((t) => t.sessionId === msg.session_id);
        if (tab) {
          const ws = workspaceStore.allWorkspaces.find((w) => w.name === msg.workspace);
          terminalStore.setTabWorkspace(tab.id, msg.workspace, ws ? { icon: ws.icon, iconColor: ws.icon_color } : null);
          workspaceStore.fetchStatuses();
        }
        toast.success(`Workspace linked: ${msg.workspace}`);
      } else if (msg?.type === "session_job_bound") {
        // 前面ジョブのargv照合による自動ジョブタグ付け（cwd照合と同じ仕組みの
        // ジョブ版）。タブのjobName/jobLabel/アイコンはこのタブが再構築される
        // まで反映されない（workspaceのようなライブ更新は未実装）ため、まずは
        // 気付けるようトーストのみ出す。
        toast.success(`Job detected: ${msg.job_label}`);
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
    // バックグラウンド復帰・オンライン復帰は待たずに即再接続し、フォアグラウンド/
    // バックグラウンドの切替え自体も閲覧状態としてサーバへ伝える。
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) reconnectNow();
      sendViewing();
    });
    on("connectivity:back", () => reconnectNow());
    // タブ切替え・タブ作成/削除でアクティブセッションが変わるたびに送る。
    watch(() => terminalStore.activeTabId, () => sendViewing());
  }

  return { start };
}
