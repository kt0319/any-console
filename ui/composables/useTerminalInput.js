import { WS_MSG_RESIZE } from "../utils/constants.js";
import { fitTerminal, sendResize } from "./useTerminalResize.js";

export function bindTerminalInput(tab) {
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

  tab.term?.onKey(() => {
    fitTerminal(tab, { force: true });
    sendResize(tab);
  });
}

export function bindTerminalElement(tab) {
  const termEl = tab.term?.element;
  if (!termEl || tab._elementBound) return;
  tab._elementBound = true;

  termEl.addEventListener("wheel", (e) => {
    e.preventDefault();
  }, { passive: false });
}
