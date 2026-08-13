import { WS_MSG_RESIZE } from "../utils/constants.ts";
import { copyTerminalSelection, isCopyShortcut } from "../utils/clipboard.ts";
import { fitTerminal, sendResize } from "./useTerminalResize.js";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { keyDefToAnsi } from "../utils/key-ansi.ts";
import { isEditableOrDialogTarget } from "../utils/dom.ts";

const APP_PAGE_KEYS = new Set(["PageUp", "PageDown"]);

function isPlainAppPageKey(e) {
  return e.type === "keydown"
    && APP_PAGE_KEYS.has(e.key)
    && !e.shiftKey
    && !e.ctrlKey
    && !e.metaKey
    && !e.altKey;
}

// WS へ入力を送る唯一の経路（bindTerminalInput / bindTerminalElement 共用）。
// 送信時刻を記録し、生存監視が「送信も activity」として扱えるようにする
// （エコー無しプログラムへの連続入力で誤切断しないため）。
function sendTabInput(tab, bytes) {
  if (tab.ws?.readyState !== WebSocket.OPEN) return;
  tab.ws.send(bytes);
  tab._lastSendAt = performance.now();
}

export function bindTerminalInput(tab) {
  if (tab._inputBound) return;
  tab._inputBound = true;

  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();

  const encoder = new TextEncoder();

  const sendInput = (bytes) => sendTabInput(tab, bytes);
  // ユーザー操作由来の入力は、送信に加えてdoneバッジも解除する
  // （onResizeの機械的な送信では解除しない）。
  const sendUserInput = (bytes) => {
    sendInput(bytes);
    terminalStore.clearDoneState(tab.sessionId);
  };

  function sendAppPageKey(e) {
    if (!isPlainAppPageKey(e)) return false;
    const seq = keyDefToAnsi({ key: e.key });
    if (!seq) return false;
    e.preventDefault();
    sendUserInput(encoder.encode(seq));
    return true;
  }

  function onGlobalKeydown(e) {
    if (terminalStore.activeTabId !== tab.id) return;
    if (layoutStore.isSessionSidebarOpen || layoutStore.isSettingsOpen) return;
    const target = /** @type {HTMLElement | null} */ (e.target);
    if (isEditableOrDialogTarget(target)) return;
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
      sendUserInput(encoder.encode("\n"));
      return false;
    }
    // 選択がある状態で Ctrl/Cmd+C はコピーに割り当てる（無選択なら SIGINT を送る）。
    // 設定画面が開いているときはそちらの標準コピー動作を優先するため対象外。
    if (isCopyShortcut(e) && !layoutStore.isSettingsOpen) {
      if (copyTerminalSelection(tab.term)) {
        e.preventDefault();
        return false;
      }
    }
    return true;
  });

  // マウス選択でテキストが確定したら自動的にブラウザクリップボードへコピーする。
  // 受動的に高頻度で走るため copyText は使わない（textarea フォールバックが
  // select() でフォーカスを奪う）。非 secure context では黙って何もしない。
  // Wayland環境ではブラウザが書き込みで所有者になったまま他アプリの上書きを
  // 検知できず、以後のペーストが古い選択テキストに化けることがあるため、
  // 設定（Copy on Select）でオフにできる。
  tab.term?.onSelectionChange(() => {
    if (!terminalStore.terminalSettings.copyOnSelect) return;
    const text = tab.term?.getSelection();
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  });

  // OSC 52: tmux が set-clipboard on のときに送ってくるクリップボード同期シーケンス。
  // data = "c;BASE64TEXT" の形式。デコードしてブラウザのクリップボードに書き込む。
  // 出力ストリーム起点の受動経路のため copyText のフォールバックは使わない（フォーカスを奪う）。
  // この経路もブラウザをクリップボード所有者にするため、copyOnSelect オフ時は
  // 書き込まない（Wayland の所有権通知問題の回避を選択時コピーと揃える）。
  tab.term?.parser.registerOscHandler(52, (data) => {
    if (!terminalStore.terminalSettings.copyOnSelect) return true;
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
    sendUserInput(encoder.encode(data));
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
      sendTabInput(tab, encoder.encode(text));
      terminalStore.clearDoneState(tab.sessionId);
    }
  }, true);
}
