import { useTerminalStore } from "../stores/terminal.js";
import { useApi } from "./useApi.js";
import { WS_CLOSE_SESSION_NOT_FOUND, WS_CLOSE_SESSION_EXITED, RECONNECT_INITIAL_DELAY, RECONNECT_BACKOFF_MULTIPLIER, RECONNECT_BACKOFF_BASE_MS, RECONNECT_BACKOFF_MAX, POST_WRITE_REFRESH_MS } from "../utils/constants.js";
import { emit } from "../app-bridge.js";
import { fitTerminal, sendResize, observeFrameResize } from "./useTerminalResize.js";
import { buildWebSocketUrl as _buildWebSocketUrl } from "../utils/terminal-ws.js";
import { bindTerminalInput, bindTerminalElement } from "./useTerminalInput.js";
import { terminalSessionPath } from "../utils/endpoints.js";

export function useTerminal() {
  const terminalStore = useTerminalStore();

  function buildWebSocketUrl(sessionId, cols, rows) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return _buildWebSocketUrl(proto, location.host, sessionId, cols, rows);
  }

  function connectTerminalWs(tab, opts = {}) {
    if (!tab || tab._wsDisposed) return;
    const frame = document.getElementById(`frame-${tab.id}`);
    const frameRect = frame?.getBoundingClientRect();
    const frameVisible = frameRect && frameRect.width >= 2 && frameRect.height >= 2;
    const dims = frameVisible ? tab.fitAddon?.proposeDimensions?.() : null;
    const wsUrl = buildWebSocketUrl(tab.sessionId, dims?.cols, dims?.rows);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    tab.ws = ws;

    ws.onopen = () => {
      tab._reconnectAttempts = 0;
      fitTerminal(tab, { force: true });
      sendResize(tab);
      if (tab._pendingRedraw) {
        tab._pendingRedraw = false;
        tab.term?.write("\x1bc");
      }
      if (tab._initialCommand && tab._waitingInitialCommand) {
        tab._waitingInitialCommand = false;
        ws.send(new TextEncoder().encode(tab._initialCommand + "\n"));
        tab._initialCommand = null;
      }
      const terminalStore = useTerminalStore();
      if (tab.term && terminalStore.activeTabId === tab.id) {
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
      tab._writeCount = (tab._writeCount || 0) + 1;
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
      if (tab._wsDisposed) return;

      if (e.code === WS_CLOSE_SESSION_EXITED) {
        emit("tab:close", { tab });
        return;
      }

      if (e.code === WS_CLOSE_SESSION_NOT_FOUND) {
        const label = tab.jobLabel || tab.label || tab.sessionId;
        emit("toast:show", { message: `${label}: Session terminated unexpectedly`, type: "error" });
        emit("tab:close", { tab });
        return;
      }

      const attempts = tab._reconnectAttempts || 0;
      const delay = attempts === 0
        ? RECONNECT_INITIAL_DELAY
        : Math.min(Math.pow(RECONNECT_BACKOFF_MULTIPLIER, attempts - 1) * RECONNECT_BACKOFF_BASE_MS, RECONNECT_BACKOFF_MAX);
      tab._reconnectAttempts = attempts + 1;
      tab._pendingRedraw = true;
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
    observeFrameResize,
    deleteSession,
  };
}
