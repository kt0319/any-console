import { shallowRef } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useTerminalStore } from "../stores/terminal.js";

const RECONNECT_BACKOFF_MAX = 30000;
const SESSION_KEEPALIVE_INTERVAL = 5 * 60 * 1000;

export function useTerminal() {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();

  function buildWebSocketUrl(sessionId) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/terminal/ws/${sessionId}?token=${encodeURIComponent(auth.token)}`;
  }

  function connectTerminalWs(tab) {
    if (!tab || tab._wsDisposed) return;
    const wsUrl = buildWebSocketUrl(tab.sessionId);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    tab.ws = ws;

    ws.onopen = () => {
      tab._reconnectAttempts = 0;
      console.log(`[ws.onopen] tab=${tab.id} pendingRedraw=${tab._pendingRedraw}`);
      fitTerminal(tab, { force: true });
      if (tab._pendingRedraw) {
        tab._pendingRedraw = false;
        tab.term?.write("\x1bc");
      }
      if (tab._initialCommand && tab._waitingInitialCommand) {
        tab._waitingInitialCommand = false;
        ws.send(new TextEncoder().encode(tab._initialCommand + "\n"));
        tab._initialCommand = null;
      }
    };

    ws.onmessage = (e) => {
      if (!tab.term) return;
      if (e.data instanceof ArrayBuffer) {
        tab.term.write(new Uint8Array(e.data));
      } else {
        tab.term.write(e.data);
      }
    };

    ws.onerror = () => {};

    ws.onclose = (e) => {
      tab.ws = null;
      if (tab._wsDisposed) return;

      if (e.code === 4001) {
        tab._replacedByOtherDevice = true;
        return;
      }

      const delay = Math.min(
        Math.pow(2, tab._reconnectAttempts || 0) * 1000,
        RECONNECT_BACKOFF_MAX,
      );
      tab._reconnectAttempts = (tab._reconnectAttempts || 0) + 1;
      tab._pendingRedraw = true;
      tab._reconnectTimer = setTimeout(() => connectTerminalWs(tab), delay);
    };

    bindTerminalInput(tab, ws);
  }

  function bindTerminalInput(tab, ws) {
    if (tab._inputBound) return;
    tab._inputBound = true;

    const encoder = new TextEncoder();
    tab.term?.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    });

    tab.term?.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        const payload = encoder.encode(JSON.stringify({ type: "resize", cols, rows }));
        const msg = new Uint8Array(1 + payload.length);
        msg[0] = 0x00;
        msg.set(payload, 1);
        ws.send(msg);
      }
    });
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
  }

  function ensureTerminalOpened(tab, frameEl) {
    if (!tab || !tab._pendingOpen || !frameEl) return false;
    tab._pendingOpen = false;
    tab.term.open(frameEl);
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

  function observeFrameResize(tab, frameEl) {
    if (tab._frameResizeObserver) {
      tab._frameResizeObserver.disconnect();
      tab._frameResizeObserver = null;
    }
    let debounceTimer = null;
    tab._frameResizeObserver = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        fitTerminal(tab);
      }, 50);
    });
    tab._frameResizeObserver.observe(frameEl);
  }

  function fitTerminal(tab, { force = false } = {}) {
    if (!tab?.term || !tab?.fitAddon) return;
    const frame = document.getElementById(`frame-${tab.id}`);
    if (frame) {
      const rect = frame.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        console.log(`[fitTerminal] tab=${tab.id} SKIP: frame too small (${rect.width}x${rect.height})`);
        return;
      }
      const dims = tab.fitAddon.proposeDimensions();
      console.log(`[fitTerminal] tab=${tab.id} force=${force} frame=${Math.round(rect.width)}x${Math.round(rect.height)} dims=${dims?.cols}x${dims?.rows} cached=${tab._lastFitCols}x${tab._lastFitRows} ws=${tab.ws?.readyState}`);
    }
    try {
      const dims = tab.fitAddon.proposeDimensions();
      if (!dims || isNaN(dims.cols) || isNaN(dims.rows)) return;
      if (!force && tab._lastFitCols === dims.cols && tab._lastFitRows === dims.rows) return;
      tab._lastFitCols = dims.cols;
      tab._lastFitRows = dims.rows;
      tab.fitAddon.fit();
    } catch {}
  }


  async function deleteSession(sessionId) {
    try {
      await auth.apiFetch(`/terminal/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
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
    buildWebSocketUrl,
  };
}
