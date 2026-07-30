import { WS_MSG_RESIZE, FRAME_FIT_DEBOUNCE_MS, FIT_WRITE_QUIET_MS, FIT_MAX_WAIT_MS } from "../utils/constants.js";

const encoder = new TextEncoder();

// 非表示タブ（v-show=false で display:none）の frame は幅/高さ 0 になる。
// 隠れている間に測った古い cols/rows をそのまま fit/resize に使うと、復帰時に
// バックグラウンド化した瞬間のサイズ（例: モバイルの小さい寸法）で PTY/tmux が
// 書き換わってしまう（表示中のタブしか見た目は変わらないため気付きにくい）。
function isFrameVisible(tab) {
  const frame = document.getElementById(`frame-${tab.id}`);
  if (!frame) return true;
  const rect = frame.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2;
}

export function fitTerminal(tab, opts = {}) {
  const force = !!opts?.force;
  if (!tab?.term || !tab?.fitAddon) return;
  if (!isFrameVisible(tab)) return;
  try {
    const dims = tab.fitAddon.proposeDimensions();
    if (!dims || isNaN(dims.cols) || isNaN(dims.rows)) return;
    if (!force && tab._lastFitCols === dims.cols && tab._lastFitRows === dims.rows) return;
    tab._lastFitCols = dims.cols;
    tab._lastFitRows = dims.rows;
    tab.fitAddon.fit();
    if (opts.scrollToBottom) {
      try { tab.term.scrollToBottom(); } catch {}
    }
  } catch {}
}

export function sendResize(tab) {
  if (!tab?.term || !tab?.ws || tab.ws.readyState !== WebSocket.OPEN) return;
  if (!isFrameVisible(tab)) return;
  const cols = tab.term.cols;
  const rows = tab.term.rows;
  if (!cols || !rows) return;
  const payload = encoder.encode(JSON.stringify({ type: "resize", cols, rows }));
  const msg = new Uint8Array(1 + payload.length);
  msg[0] = WS_MSG_RESIZE;
  msg.set(payload, 1);
  tab.ws.send(msg);
}

export function observeFrameResize(tab, frameEl) {
  if (tab._frameResizeObserver) {
    tab._frameResizeObserver.disconnect();
    tab._frameResizeObserver = null;
  }
  let debounceTimer = null;
  let firstRequestAt = 0;
  const tryFit = () => {
    const now = performance.now();
    const sinceWrite = now - (tab._lastWriteAt || 0);
    const sinceRequest = now - firstRequestAt;
    if (sinceWrite < FIT_WRITE_QUIET_MS && sinceRequest < FIT_MAX_WAIT_MS) {
      debounceTimer = setTimeout(tryFit, FIT_WRITE_QUIET_MS - sinceWrite);
      return;
    }
    debounceTimer = null;
    firstRequestAt = 0;
    fitTerminal(tab);
  };
  tab._frameResizeObserver = new ResizeObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!firstRequestAt) firstRequestAt = performance.now();
    debounceTimer = setTimeout(tryFit, FRAME_FIT_DEBOUNCE_MS);
  });
  tab._frameResizeObserver.observe(frameEl);
}
