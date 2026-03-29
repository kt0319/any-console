import { shallowRef } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useApi } from "./useApi.js";
import { WS_MSG_RESIZE, WS_CLOSE_SESSION_EXITED, RECONNECT_INITIAL_DELAY, RECONNECT_BACKOFF_MAX } from "../utils/constants.js";
import { emit } from "../app-bridge.js";

export function useTerminal() {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();

  function buildWebSocketUrl(sessionId, cols, rows) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    let url = `${proto}//${location.host}/terminal/ws/${sessionId}?token=${encodeURIComponent(auth.token)}`;
    if (cols && rows) {
      url += `&cols=${cols}&rows=${rows}`;
    }
    return url;
  }

  function connectTerminalWs(tab) {
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
      tab._writeCount = (tab._writeCount || 0) + 1;
      clearTimeout(tab._postWriteRefresh);
      tab._postWriteRefresh = setTimeout(() => {
        if (tab._writeCount >= 50 && tab.term) {
          try { tab.term.refresh(0, tab.term.rows - 1); } catch {}
        }
        tab._writeCount = 0;
      }, 300);
    };

    ws.onerror = () => {};

    ws.onclose = (e) => {
      tab.ws = null;
      if (tab._wsDisposed) return;

      if (e.code === WS_CLOSE_SESSION_EXITED) {
        const label = tab.jobLabel || tab.label || tab.sessionId;
        emit("toast:show", { message: `${label}: セッションが予期せず終了しました`, type: "error" });
        emit("tab:close", { tab });
        return;
      }

      const attempts = tab._reconnectAttempts || 0;
      const delay = attempts === 0
        ? RECONNECT_INITIAL_DELAY
        : Math.min(Math.pow(2, attempts - 1) * 1000, RECONNECT_BACKOFF_MAX);
      tab._reconnectAttempts = attempts + 1;
      tab._pendingRedraw = true;
      tab._reconnectTimer = setTimeout(() => connectTerminalWs(tab), delay);
    };

    bindTerminalInput(tab);
  }

  function bindTerminalInput(tab) {
    if (tab._inputBound) return;
    tab._inputBound = true;

    const encoder = new TextEncoder();

    tab.term?.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        if (tab.ws?.readyState === WebSocket.OPEN) {
          tab.ws.send(encoder.encode("\n"));
        }
        return false;
      }
      return true;
    });

    tab.term?.onData((data) => {
      if (tab.ws?.readyState === WebSocket.OPEN) {
        tab.ws.send(encoder.encode(data));
      }
    });

    tab.term?.onResize(({ cols, rows }) => {
      if (tab.ws?.readyState === WebSocket.OPEN) {
        const payload = encoder.encode(JSON.stringify({ type: "resize", cols, rows }));
        const msg = new Uint8Array(1 + payload.length);
        msg[0] = WS_MSG_RESIZE;
        msg.set(payload, 1);
        tab.ws.send(msg);
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
    clearTimeout(tab._postWriteRefresh);
  }

  function bindTerminalElement(tab) {
    const termEl = tab.term?.element;
    if (!termEl || tab._elementBound) return;
    tab._elementBound = true;

    termEl.addEventListener("wheel", (e) => {
      e.preventDefault();
    }, { passive: false });
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

  function fitTerminal(tab, opts = {}) {
    const force = !!opts?.force;
    if (!tab?.term || !tab?.fitAddon) return;
    const frame = document.getElementById(`frame-${tab.id}`);
    if (frame) {
      const rect = frame.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
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
      const { apiDelete } = useApi();
      await apiDelete(`/terminal/sessions/${encodeURIComponent(sessionId)}`);
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
