import { WS_MSG_RESIZE } from "../utils/constants.js";
import { copyText } from "../utils/clipboard.js";
import { fitTerminal, sendResize } from "./useTerminalResize.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { keyDefToAnsi } from "../utils/key-ansi.js";
import { isEditableTarget } from "../utils/dom.js";

const APP_PAGE_KEYS = new Set(["PageUp", "PageDown"]);

function isPlainAppPageKey(e) {
  return e.type === "keydown"
    && APP_PAGE_KEYS.has(e.key)
    && !e.shiftKey
    && !e.ctrlKey
    && !e.metaKey
    && !e.altKey;
}

export function bindTerminalInput(tab) {
  if (tab._inputBound) return;
  tab._inputBound = true;

  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();

  const encoder = new TextEncoder();

  // WS へ入力を送る唯一の経路。送信時刻を記録し、生存監視が「送信も activity」
  // として扱えるようにする（エコー無しプログラムへの連続入力で誤切断しないため）。
  const sendInput = (bytes) => {
    if (tab.ws?.readyState !== WebSocket.OPEN) return;
    tab.ws.send(bytes);
    tab._lastSendAt = performance.now();
  };

  function sendAppPageKey(e) {
    if (!isPlainAppPageKey(e)) return false;
    const seq = keyDefToAnsi({ key: e.key });
    if (!seq) return false;
    e.preventDefault();
    sendInput(encoder.encode(seq));
    terminalStore.clearDoneState(tab.sessionId);
    return true;
  }

  function onGlobalKeydown(e) {
    if (terminalStore.activeTabId !== tab.id) return;
    if (layoutStore.isSessionSidebarOpen || layoutStore.isSettingsOpen) return;
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (target && isEditableTarget(target)) return;
    if (target?.closest?.("[role='dialog']")) return;
    if (sendAppPageKey(e)) e.stopPropagation();
  }

  window.addEventListener("keydown", onGlobalKeydown, true);
  tab._releaseInput = () => {
    window.removeEventListener("keydown", onGlobalKeydown, true);
  };

  tab.term?.attachCustomKeyEventHandler((e) => {
    if (sendAppPageKey(e)) {
      return false;
    }
    if (e.type === "keydown" && e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      sendInput(encoder.encode("\n"));
      terminalStore.clearDoneState(tab.sessionId);
      return false;
    }
    // 選択がある状態で Ctrl/Cmd+C はコピーに割り当てる（無選択なら SIGINT を送る）。
    // 設定画面が開いているときはそちらの標準コピー動作を優先するため対象外。
    if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C") && !layoutStore.isSettingsOpen) {
      if (tab.term?.hasSelection?.()) {
        const text = tab.term.getSelection();
        if (text) copyText(text);
        e.preventDefault();
        return false;
      }
    }
    return true;
  });

  // マウス選択でテキストが確定したら自動的にブラウザクリップボードへコピーする。
  // 受動的に高頻度で走るため copyText は使わない（textarea フォールバックが
  // select() でフォーカスを奪う）。非 secure context では黙って何もしない。
  tab.term?.onSelectionChange(() => {
    const text = tab.term?.getSelection();
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  });

  // OSC 52: tmux が set-clipboard on のときに送ってくるクリップボード同期シーケンス。
  // data = "c;BASE64TEXT" の形式。デコードしてブラウザのクリップボードに書き込む。
  // 出力ストリーム起点の受動経路のため copyText のフォールバックは使わない（フォーカスを奪う）。
  tab.term?.parser.registerOscHandler(52, (data) => {
    const semi = data.indexOf(";");
    if (semi === -1) return false;
    const b64 = data.slice(semi + 1);
    if (!b64 || b64 === "?") return false;
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch {}
    return true;
  });

  tab.term?.onData((data) => {
    sendInput(encoder.encode(data));
    terminalStore.clearDoneState(tab.sessionId);
  });

  tab.term?.onResize(({ cols, rows }) => {
    const payload = encoder.encode(JSON.stringify({ type: "resize", cols, rows }));
    const msg = new Uint8Array(1 + payload.length);
    msg[0] = WS_MSG_RESIZE;
    msg.set(payload, 1);
    sendInput(msg);
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

  const terminalStore = useTerminalStore();

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
      tab._lastSendAt = performance.now();
      terminalStore.clearDoneState(tab.sessionId);
    }
  }, true);
}
