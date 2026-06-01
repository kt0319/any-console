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
    // 選択がある状態で Ctrl/Cmd+C はコピーに割り当てる（無選択なら SIGINT を送る）
    if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C")) {
      if (tab.term?.hasSelection?.()) {
        const text = tab.term.getSelection();
        if (text && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).catch(() => {});
        }
        e.preventDefault();
        return false;
      }
    }
    return true;
  });

  // OSC 52: tmux が set-clipboard on のときに送ってくるクリップボード同期シーケンス。
  // data = "c;BASE64TEXT" の形式。デコードしてブラウザのクリップボードに書き込む。
  tab.term?.parser.registerOscHandler(52, (data) => {
    const semi = data.indexOf(";");
    if (semi === -1) return false;
    const b64 = data.slice(semi + 1);
    if (!b64 || b64 === "?") return false;
    try {
      const text = atob(b64);
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {}
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

  // bracketed paste の制御文字がシェルに解釈されず素のままターミナルに出る環境を
  // 救うため、paste は xterm.js の組み込み処理を迂回して plain text のみ送る。
  const encoder = new TextEncoder();
  termEl.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    if (tab.ws?.readyState === WebSocket.OPEN) {
      tab.ws.send(encoder.encode(text));
    }
  }, true);
}
