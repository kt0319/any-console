import { watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useAgentStateStore } from "../stores/agent-state.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { applyDispatchQueue } from "./useDispatchQueue.ts";
import { useSessionSync } from "./useSessionSync.ts";
import { emit, on } from "../app-bridge.ts";
import { statusStreamSettled } from "../utils/status-stream-sync.ts";
import { debugLog } from "./useClientLogs.ts";
import { reloadIfNewBuild } from "../utils/build-update.ts";
import {
  buildStatusStreamUrl,
  buildViewingMessage,
  parseStatusStreamMessage,
  statusStreamReconnectDelay,
} from "../utils/status-stream.ts";
import {
  acceptGitHubActivitySeq,
  buildWatchGitHubMessage,
  onGitHubWatchChange,
  rebaseGitHubActivitySeq,
} from "../utils/github-watch.ts";

// アプリ全体で 1 本の WS を共有するモジュールシングルトン。
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let started = false;

/**
 * git ステータス／エージェント状態／dispatch キュー／セッション作成・削除のリアルタイム配信 WS を購読する。
 * セッション増減の通知はポーリング待ちを避けるnudgeで、既存の syncSessionsFromServer() を呼ぶ。
 * 切断時はバックオフ付きで再接続し、再接続のたびに全量同期して取りこぼしを埋める。
 */
export function useStatusStream() {
  const workspaceStore = useWorkspaceStore();
  const terminalStore = useTerminalStore();
  const { syncSessionsFromServer } = useSessionSync();

  function isClosed() {
    return !socket || socket.readyState === WebSocket.CLOSED;
  }

  // 今アクティブなタブのsessionId。タブが非表示（バックグラウンド化）中は
  // null扱いにする — push通知の「見ているなら送らない」抑制はユーザーが実際に
  // 画面を見ている時だけ効かせたいため。
  function currentViewingSessionId() {
    if (document.hidden) return null;
    const tab = terminalStore.activeTab;
    return tab?.sessionId || null;
  }

  function sendViewing() {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(buildViewingMessage(currentViewingSessionId()));
  }

  // サーバ側の宣言も接続単位のため、再接続のたびに最終 seq 付きで送り直す。
  function sendWatchGitHub() {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(buildWatchGitHubMessage());
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
      sendWatchGitHub();
      reloadIfNewBuild().catch((e) => console.error("reloadIfNewBuild failed:", e));
      // 切断中の変更を取りこぼしている可能性があるため、接続のたびに全量を同期する
      void workspaceStore.fetchStatuses().finally(() => {
        if (socket === ws) statusStreamSettled.value = true;
      });
    };
    ws.onmessage = (e) => {
      const msg = parseStatusStreamMessage(e.data);
      if (msg?.type === "statuses") {
        workspaceStore.applyStatuses(msg.statuses);
      } else if (msg?.type === "agent_states") {
        useAgentStateStore().applyAgentStates(msg.states);
      } else if (msg?.type === "dispatch_queue") {
        applyDispatchQueue(msg.items, msg.recent);
      } else if (msg?.type === "github_activity") {
        if (acceptGitHubActivitySeq(msg.workspace, msg.seq)) {
          emit("github:activity", { workspace: msg.workspace, items: msg.items });
        }
      } else if (msg?.type === "github_activity_reset") {
        rebaseGitHubActivitySeq(msg.workspace, msg.seq);
      } else if (msg?.type === "phrase_notify") {
        useAgentStateStore().markPhraseNotify(msg.session_id);
      } else if (msg?.type === "phrase_notify_clear") {
        useAgentStateStore().clearPhraseNotify(msg.session_id);
      } else if (msg?.type === "session_created" || msg?.type === "session_removed") {
        syncSessionsFromServer();
      } else if (msg?.type === "session_workspace_bound") {
        // cwd照合による自動ワークスペース紐付けの通知。該当タブが開いていれば次のポーリングを待たず即更新する。
        const tab = terminalStore.openTabs.find((t) => t.sessionId === msg.session_id);
        if (tab) {
          const ws = workspaceStore.allWorkspaces.find((w) => w.name === msg.workspace);
          terminalStore.setTabWorkspace(tab.id, msg.workspace, ws ? { icon: ws.icon, iconColor: ws.icon_color } : null);
          workspaceStore.fetchStatuses();
        }
        emit("session:workspaceBound", { sessionId: msg.session_id });
      } else if (msg?.type === "session_job_bound") {
        // 前面ジョブのargv照合による自動ジョブタグ付け。該当タブが開いていれば次のポーリングを待たず即更新する。
        const tab = terminalStore.openTabs.find((t) => t.sessionId === msg.session_id);
        if (tab) {
          terminalStore.setTabJob(tab.id, msg.job_name, msg.job_label, { icon: msg.icon, iconColor: msg.icon_color });
        }
        emit("session:jobBound", { sessionId: msg.session_id });
      }
    };
    ws.onclose = () => {
      statusStreamSettled.value = false;
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

  function start() {
    if (started) return;
    started = true;
    connect();
    // バックグラウンド復帰・オンライン復帰は待たず即再接続し、フォアグラウンド/バックグラウンドの切替えも閲覧状態として伝える。
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) reconnectNow();
      sendViewing();
    });
    on("connectivity:back", () => reconnectNow());
    onGitHubWatchChange(sendWatchGitHub);
    watch(() => terminalStore.activeTabId, () => sendViewing());
  }

  return { start };
}
