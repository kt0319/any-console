import { WS_MSG_RESIZE } from "../utils/constants.ts";
import { copyTerminalSelection, isCopyShortcut } from "../utils/clipboard.ts";
import { fitTerminal, sendResize } from "./useTerminalResize.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useAgentStateStore } from "../stores/agent-state.ts";
import { useTerminalSettingsStore } from "../stores/terminal-settings.ts";
import type { TerminalTab } from "../stores/terminal.ts";
import { keyDefToAnsi } from "../utils/key-ansi.ts";
import { isEditableOrDialogTarget } from "../utils/dom.ts";

const APP_PAGE_KEYS = new Set(["PageUp", "PageDown"]);

function isPlainAppPageKey(e: KeyboardEvent) {
  return e.type === "keydown"
    && APP_PAGE_KEYS.has(e.key)
    && !e.shiftKey
    && !e.ctrlKey
    && !e.metaKey
    && !e.altKey;
}

// WS へ入力を送る唯一の経路。送信時刻を記録し、エコー無しプログラムへの連続入力で生存監視が誤切断しないようにする。
function sendTabInput(tab: TerminalTab, bytes: Uint8Array) {
  if (tab.ws?.readyState !== WebSocket.OPEN) return;
  tab.ws.send(bytes);
  tab._lastSendAt = performance.now();
}

export function bindTerminalInput(tab: TerminalTab) {
  if (tab._inputBound) return;
  tab._inputBound = true;

  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();

  const encoder = new TextEncoder();

  const sendInput = (bytes: Uint8Array) => sendTabInput(tab, bytes);
  // ユーザー操作由来の入力は通知バッジも解除する（タブ切替が起きない既アクティブタブ対策。onResize の機械送信では解除しない）。
  const sendUserInput = (bytes: Uint8Array) => {
    sendInput(bytes);
    useAgentStateStore().clearSessionNotifyBadges(tab.sessionId);
  };

  function sendAppPageKey(e: KeyboardEvent) {
    if (!isPlainAppPageKey(e)) return false;
    const seq = keyDefToAnsi({ key: e.key });
    if (!seq) return false;
    e.preventDefault();
    sendUserInput(encoder.encode(seq));
    return true;
  }

  function onGlobalKeydown(e: KeyboardEvent) {
    if (terminalStore.activeTabId !== tab.id) return;
    if (layoutStore.isSessionSidebarOpen || layoutStore.isAnyOverlayOpen) return;
    const target = e.target as HTMLElement | null;
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
    if (isCopyShortcut(e) && !layoutStore.isAnyOverlayOpen) {
      if (copyTerminalSelection(tab.term)) {
        e.preventDefault();
        return false;
      }
    }
    return true;
  });

  // 受動的に高頻度で走るため copyText は使わない（textarea フォールバックが select() でフォーカスを奪う）。
  // Wayland ではブラウザが所有者のまま他アプリの上書きを検知できず古い選択が貼られることがあるため、設定でオフにできる。
  tab.term?.onSelectionChange(() => {
    if (!useTerminalSettingsStore().terminalSettings.copyOnSelect) return;
    const text = tab.term?.getSelection();
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  });

  // OSC 52（tmux set-clipboard on）。ブラウザをクリップボード所有者にするため、Wayland 対策で copyOnSelect オフ時は書き込まない。
  tab.term?.parser.registerOscHandler(52, (data) => {
    if (!useTerminalSettingsStore().terminalSettings.copyOnSelect) return true;
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

export function bindTerminalElement(tab: TerminalTab) {
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
      sendTabInput(tab, encoder.encode(text));
      useAgentStateStore().clearDoneState(tab.sessionId);
    }
  }, true);
}
