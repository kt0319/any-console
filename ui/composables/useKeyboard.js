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
    dispatchKeyToTab(getActiveTerminalTab(), keyDef);
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

