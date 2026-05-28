import { useTerminalStore } from "../stores/terminal.js";
import { useApi } from "./useApi.js";
import { WS_CLOSE_SESSION_NOT_FOUND, WS_CLOSE_SESSION_EXITED, RECONNECT_INITIAL_DELAY, RECONNECT_BACKOFF_MULTIPLIER, RECONNECT_BACKOFF_BASE_MS, RECONNECT_BACKOFF_MAX, POST_WRITE_REFRESH_MS, WRITE_COUNT_REFRESH_INTERVAL, RECONNECTING_OVERLAY_MIN_ATTEMPTS } from "../utils/constants.js";
import { emit } from "../app-bridge.js";
import { useToast } from "./useToast.js";
import { fitTerminal, sendResize, observeFrameResize } from "./useTerminalResize.js";
import { buildWebSocketUrl as _buildWebSocketUrl } from "../utils/terminal-ws.js";
import { bindTerminalInput, bindTerminalElement } from "./useTerminalInput.js";
import { terminalSessionPath, terminalSessionHistoryPath } from "../utils/endpoints.js";
import { debugLog } from "./useClientLogs.js";

export function useTerminal() {
  const terminalStore = useTerminalStore();
  const toast = useToast();

  function buildWebSocketUrl(sessionId, cols, rows) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return _buildWebSocketUrl(proto, location.host, sessionId, cols, rows);
  }

  async function restoreHistoryIfNeeded(tab) {
    if (!tab._needsHistoryRestore || !tab.term) return;
    tab._needsHistoryRestore = false;
    try {
      const { apiGet } = useApi();
      // history を取り出す前に backend で tmux pane を xterm と同じサイズへリサイズさせる。
      // 古いサイズで wrap された出力が新サイズの xterm に書かれて崩れるのを防ぐ。
      const dims = tab.fitAddon?.proposeDimensions?.();
      const cols = Number.isFinite(dims?.cols) ? dims.cols : tab.term.cols;
      const rows = Number.isFinite(dims?.rows) ? dims.rows : tab.term.rows;
      const { ok, data } = await apiGet(terminalSessionHistoryPath(tab.sessionId, { cols, rows }));
      if (ok && data?.content) {
        tab.term.write(data.content);
        tab._lastWriteAt = performance.now();
      }
    } catch {}
  }

  async function connectTerminalWs(tab, opts = {}) {
    if (!tab || tab._wsDisposed) return;
    // history を書き込む前に fit して cols を確定させる。
    // 後から fit が走ると ANSI のカーソル位置が古い cols 基準のままになり画面が崩れる。
    fitTerminal(tab, { force: true });
    await restoreHistoryIfNeeded(tab);
    if (tab._wsDisposed) return;
    const frame = document.getElementById(`frame-${tab.id}`);
    const frameRect = frame?.getBoundingClientRect();
    const frameVisible = frameRect && frameRect.width >= 2 && frameRect.height >= 2;
    const dims = frameVisible ? tab.fitAddon?.proposeDimensions?.() : null;
    const wsUrl = buildWebSocketUrl(tab.sessionId, dims?.cols, dims?.rows);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    tab.ws = ws;
    if ((tab._reconnectAttempts || 0) >= RECONNECTING_OVERLAY_MIN_ATTEMPTS) {
      terminalStore.setTabFlag(tab.id, "reconnecting", true);
    }
    const wsOpenedAt = performance.now();
    debugLog("[WS] connect", tab.sessionId?.slice(-8), `cols=${dims?.cols}`, `rows=${dims?.rows}`);

    ws.onopen = () => {
      debugLog("[WS] open", tab.sessionId?.slice(-8), `${Math.round(performance.now() - wsOpenedAt)}ms`);
      tab._reconnectAttempts = 0;
      fitTerminal(tab, { force: true });
      sendResize(tab);
      if (tab._pendingRedraw) {
        tab._pendingRedraw = false;
        try { tab.term?.refresh(0, tab.term.rows - 1); } catch {}
      }
      terminalStore.setTabFlag(tab.id, "reconnecting", false);
      if (tab._initialCommand && tab._waitingInitialCommand) {
        tab._waitingInitialCommand = false;
        ws.send(new TextEncoder().encode(tab._initialCommand + "\n"));
        tab._initialCommand = null;
      }
      if (tab.term && terminalStore.activeTabId === tab.id && opts.focus !== false) {
        tab.term.focus();
      }
      if (opts.onOpen) opts.onOpen();
    };

    ws.onmessage = (e) => {
      if (!tab.term) return;
      if (e.data instanceof ArrayBuffer) {
        tab.term.write(new Uint8Array(e.data));
      } else {
        tab.term.write(e.data);
      }
      tab._lastWriteAt = performance.now();
      tab._writeCount = (tab._writeCount || 0) + 1;
      if (tab._writeCount % WRITE_COUNT_REFRESH_INTERVAL === 0) {
        try { tab.term.refresh(0, tab.term.rows - 1); } catch {}
      }
      clearTimeout(tab._postWriteRefresh);
      tab._postWriteRefresh = setTimeout(() => {
        if (tab._writeCount >= 50 && tab.term) {
          try { tab.term.refresh(0, tab.term.rows - 1); } catch {}
        }
        tab._writeCount = 0;
      }, POST_WRITE_REFRESH_MS);
    };

    ws.onerror = () => {};

    ws.onclose = (e) => {
      tab.ws = null;
      debugLog("[WS] close", tab.sessionId?.slice(-8), `code=${e.code}`, e.reason || "");
      if (tab._wsDisposed) return;

      if (e.code === WS_CLOSE_SESSION_EXITED) {
        emit("tab:close", { tab });
        return;
      }

      if (e.code === WS_CLOSE_SESSION_NOT_FOUND) {
        const label = tab.jobLabel || tab.label || tab.sessionId;
        toast.error(`${label}: Session terminated unexpectedly`);
        emit("tab:close", { tab });
        return;
      }

      const attempts = tab._reconnectAttempts || 0;
      const delay = attempts === 0
        ? RECONNECT_INITIAL_DELAY
        : Math.min(Math.pow(RECONNECT_BACKOFF_MULTIPLIER, attempts - 1) * RECONNECT_BACKOFF_BASE_MS, RECONNECT_BACKOFF_MAX);
      tab._reconnectAttempts = attempts + 1;
      tab._pendingRedraw = true;
      debugLog("[WS] reconnect", tab.sessionId?.slice(-8), `attempt=${attempts + 1}`, `delay=${delay}ms`);
      clearTimeout(tab._reconnectTimer);
      tab._reconnectTimer = setTimeout(() => connectTerminalWs(tab), delay);
    };

    bindTerminalInput(tab);
  }

  function disconnectTerminal(tab) {
    if (!tab) return;
    tab._wsDisposed = true;
    if (tab.ws) {
      tab.ws.close(1000);
      tab.ws = null;
    }
    if (tab._frameResizeObserver) {
      tab._frameResizeObserver.disconnect();
      tab._frameResizeObserver = null;
    }
    clearTimeout(tab._reconnectTimer);
    clearTimeout(tab._activityTimer);
    clearTimeout(tab._postWriteRefresh);
    terminalStore.clearTabFlags(tab.id);
  }

  function ensureTerminalOpened(tab, frameEl) {
    if (!tab || !tab._pendingOpen || !frameEl) return false;
    tab._pendingOpen = false;
    tab.term.open(frameEl);
    bindTerminalElement(tab);
    if (!tab._pendingRedraw) {
      connectTerminalWs(tab);
    }
    observeFrameResize(tab, frameEl);
    return true;
  }

  function connectDeferredTabs() {
    const terminalStore = useTerminalStore();
    for (const tab of terminalStore.openTabs) {
      if (tab._pendingRedraw && !tab.ws && !tab._wsDisposed) {
        connectTerminalWs(tab);
      }
    }
  }

  async function deleteSession(sessionId) {
    try {
      const { apiDelete } = useApi();
      await apiDelete(terminalSessionPath(sessionId));
    } catch {}
  }

  return {
    connectTerminalWs,
    connectDeferredTabs,
    disconnectTerminal,
    ensureTerminalOpened,
    fitTerminal,
    sendResize,
    observeFrameResize,
    deleteSession,
  };
}
