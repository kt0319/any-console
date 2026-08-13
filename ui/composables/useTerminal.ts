import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { WS_CLOSE_SESSION_NOT_FOUND, WS_CLOSE_SESSION_EXITED, RECONNECT_INITIAL_DELAY, POST_WRITE_REFRESH_MS, RECONNECTING_OVERLAY_MIN_ATTEMPTS, TERMINAL_BULK_WRITE_REFRESH_THRESHOLD } from "../utils/constants.ts";
import { reconnectBackoffDelay } from "../utils/backoff.ts";
import { emit } from "../app-bridge.js";
import { useToast } from "./useToast.ts";
import { fitTerminal, sendResize, observeFrameResize } from "./useTerminalResize.ts";
import { buildWebSocketUrl as _buildWebSocketUrl } from "../utils/terminal-ws.ts";
import { bindTerminalInput, bindTerminalElement } from "./useTerminalInput.ts";
import { terminalSessionPath, terminalSessionHistoryPath } from "../utils/endpoints.ts";
import { debugLog } from "./useClientLogs.ts";

type ConnectOpts = { focus?: boolean, onOpen?: () => void };

export function useTerminal() {
  const terminalStore = useTerminalStore();
  const toast = useToast();

  function buildWebSocketUrl(sessionId: string, cols?: number, rows?: number) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return _buildWebSocketUrl(proto, location.host, sessionId, cols, rows);
  }

  async function restoreHistoryIfNeeded(tab: TerminalTab) {
    if (!tab._needsHistoryRestore || !tab.term) return;
    tab._needsHistoryRestore = false;
    try {
      const { apiGet } = useApi();
      // history を取り出す前に backend で tmux pane を xterm と同じサイズへリサイズさせる。
      // 古いサイズで wrap された出力が新サイズの xterm に書かれて崩れるのを防ぐ。
      const dims = tab.fitAddon?.proposeDimensions?.();
      const cols = dims && Number.isFinite(dims.cols) ? dims.cols : tab.term.cols;
      const rows = dims && Number.isFinite(dims.rows) ? dims.rows : tab.term.rows;
      const { ok, data } = await getWithRetry(apiGet, terminalSessionHistoryPath(tab.sessionId, { cols, rows }));
      if (ok && data?.content) {
        // capture-pane は全スクロールバックを返すため、書き込み前に必ず一度リセットする。
        // 新規/空の xterm では no-op だが、半開き接続からの再接続（既に内容が
        // 描画済み）では reset しないと同じ内容が二重に積み上がる。
        tab.term.reset();
        tab.term.write(data.content);
        tab._lastWriteAt = performance.now();
      }
    } catch {}
  }

  async function connectTerminalWs(tab: TerminalTab | null | undefined, opts: ConnectOpts = {}) {
    if (!tab || tab._wsDisposed) return;
    // 二重接続ガード。再接続タイマー・セッション復帰・タブ切替が並走すると
    // 同じ xterm へ 2 本の WS が書き込み、再描画が交錯して表示が崩れる。
    // history 復元の await 中も `_connecting` で締め出す。
    if (tab.ws || tab._connecting) return;
    tab._connecting = true;
    try {
      // history を書き込む前に fit して cols を確定させる。
      // 後から fit が走ると ANSI のカーソル位置が古い cols 基準のままになり画面が崩れる。
      fitTerminal(tab, { force: true });
      await restoreHistoryIfNeeded(tab);
      if (tab._wsDisposed) return;
      connectWebSocket(tab, opts);
    } finally {
      tab._connecting = false;
    }
  }

  function connectWebSocket(tab: TerminalTab, opts: ConnectOpts = {}) {
    const frame = document.getElementById(`frame-${tab.id}`);
    const frameRect = frame?.getBoundingClientRect();
    const frameVisible = frameRect && frameRect.width >= 2 && frameRect.height >= 2;
    const dims = frameVisible ? tab.fitAddon?.proposeDimensions?.() : null;
    // 非表示タブ（フレーム寸法 0）は xterm の現在サイズで接続する。サイズ未指定だと
    // サーバがデフォルト 80x24 でアタッチし、xterm のバッファ幅と食い違う再描画が
    // 書き込まれて崩れる。
    const cols = dims && Number.isFinite(dims.cols) ? dims.cols : tab.term?.cols;
    const rows = dims && Number.isFinite(dims.rows) ? dims.rows : tab.term?.rows;
    const wsUrl = buildWebSocketUrl(tab.sessionId, cols, rows);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    tab.ws = ws;
    if ((tab._reconnectAttempts || 0) >= RECONNECTING_OVERLAY_MIN_ATTEMPTS) {
      terminalStore.clearAgentState(tab.sessionId);
      terminalStore.setTabFlag(tab.id, "reconnecting", true);
      terminalStore.setTabFlag(tab.id, "reconnectReason", `retry ${tab._reconnectAttempts}`);
    }
    const wsOpenedAt = performance.now();
    debugLog("[WS] connect", tab.sessionId?.slice(-8), `cols=${cols}`, `rows=${rows}`);

    ws.onopen = () => {
      debugLog("[WS] open", tab.sessionId?.slice(-8), `${Math.round(performance.now() - wsOpenedAt)}ms`);
      // 生存監視の起点。最初のフレーム受信前に stale 判定されないよう open 時刻を記録する。
      tab._lastWriteAt = performance.now();
      tab._reconnectAttempts = 0;
      fitTerminal(tab, { force: true });
      sendResize(tab);
      if (tab._pendingRedraw) {
        tab._pendingRedraw = false;
        try { tab.term?.refresh(0, tab.term.rows - 1); } catch {}
      }
      terminalStore.setTabFlag(tab.id, "reconnecting", false);
      terminalStore.setTabFlag(tab.id, "reconnectReason", null);
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
      if (tab._postWriteRefresh) clearTimeout(tab._postWriteRefresh);
      tab._postWriteRefresh = setTimeout(() => {
        if ((tab._writeCount || 0) >= TERMINAL_BULK_WRITE_REFRESH_THRESHOLD && tab.term) {
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
      const delay = reconnectBackoffDelay(attempts, { initialDelay: RECONNECT_INITIAL_DELAY });
      tab._reconnectAttempts = attempts + 1;
      tab._pendingRedraw = true;
      debugLog("[WS] reconnect", tab.sessionId?.slice(-8), `attempt=${attempts + 1}`, `delay=${delay}ms`);
      if (tab._reconnectTimer) clearTimeout(tab._reconnectTimer);
      tab._reconnectTimer = setTimeout(() => connectTerminalWs(tab), delay);
    };

    bindTerminalInput(tab);
  }

  function disconnectTerminal(tab: TerminalTab | null | undefined) {
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
    tab._releaseInput?.();
    tab._releaseInput = null;
    if (tab._reconnectTimer) clearTimeout(tab._reconnectTimer);
    if (tab._activityTimer) clearTimeout(tab._activityTimer);
    if (tab._postWriteRefresh) clearTimeout(tab._postWriteRefresh);
    terminalStore.clearTabFlags(tab.id);
  }

  function ensureTerminalOpened(tab: TerminalTab | null | undefined, frameEl: HTMLElement | null | undefined) {
    if (!tab || !tab._pendingOpen || !frameEl) return false;
    tab._pendingOpen = false;
    tab.term!.open(frameEl);
    bindTerminalElement(tab);
    if (!tab._pendingRedraw && !tab.ws) {
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

  async function deleteSession(sessionId: string) {
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
