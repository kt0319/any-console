import { reactive } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { keyDefToAnsi } from "../utils/key-ansi.js";
import { dispatchKeyToTab, dispatchTextToTab } from "../utils/terminal-dispatch.js";
import { attachFlickKey } from "./useFlickKey.js";

const modifierState = reactive({ ctrl: false, shift: false });

export function useKeyboard() {
  const terminalStore = useTerminalStore();

  function getActiveTerminalTab() {
    const tabs = terminalStore.openTabs;
    const id = terminalStore.activeTabId;
    const tab = tabs.find((t) => t.id === id);
    if (!tab || !tab.term) return null;
    return tab;
  }

  function sendKeyToTerminal(keyDef) {
    // sticky な修飾キー（Shift / Ctrl のトグル状態）が立っていれば自動で付与し、
    // 送信後にクリアする。これでフリックキーバー側の Tab/Space 等にも Shift+
    // が反映される（呼び出し側で keyDef.shift を明示済みなら上書きしない）。
    const merged = { ...keyDef };
    if (merged.shift == null && modifierState.shift) merged.shift = true;
    if (merged.ctrl == null && modifierState.ctrl) merged.ctrl = true;
    dispatchKeyToTab(getActiveTerminalTab(), merged);
    if (modifierState.shift || modifierState.ctrl) clearModifiers();
  }

  function sendTextToTerminal(text) {
    dispatchTextToTab(getActiveTerminalTab(), text);
  }

  function scrollTerminal(direction) {
    const tab = getActiveTerminalTab();
    if (!tab || !tab.term) return;
    tab.term.scrollLines(direction === "up" ? -20 : 20);
  }

  function clearModifiers() {
    modifierState.ctrl = false;
    modifierState.shift = false;
  }

  function setupFlickRepeat(el, resolveKey, onTap, opts = {}) {
    attachFlickKey(el, resolveKey, sendKeyToTerminal, onTap, opts);
  }

  return {
    modifierState,
    sendKeyToTerminal,
    sendTextToTerminal,
    scrollTerminal,
    clearModifiers,
    keyDefToAnsi,
    setupFlickRepeat,
    getActiveTerminalTab,
  };
}

