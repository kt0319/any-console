import { WS_MSG_RESIZE } from "../utils/constants.js";

const encoder = new TextEncoder();

export function fitTerminal(tab, opts = {}) {
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

export function sendResize(tab) {
  if (!tab?.term || !tab?.ws || tab.ws.readyState !== WebSocket.OPEN) return;
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
  tab._frameResizeObserver = new ResizeObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      fitTerminal(tab);
    }, 50);
  });
  tab._frameResizeObserver.observe(frameEl);
}
