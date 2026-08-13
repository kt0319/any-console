import { reactive } from "vue";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { keyDefToAnsi } from "../utils/key-ansi.ts";
import { dispatchKeyToTab, dispatchTextToTab } from "../utils/terminal-dispatch.ts";
import { attachFlickKey } from "./useFlickKey.ts";

const modifierState = reactive({ ctrl: false, shift: false });

type KeyDef = { key: string, ctrl?: boolean, shift?: boolean };

// attachFlickKey（useFlickKey.ts）の実シグネチャ。onTap 等の省略可能引数が
// 型推論では null 固定になるため、呼び出し側で実態の型を明示する。
type AttachFlickKey = (
  el: HTMLElement,
  resolveKey: (dx: number, dy: number, threshold: number) => any,
  sendKey: (keyDef: KeyDef) => void,
  onTap?: (() => void) | null,
  opts?: {
    accelerateRepeat?: boolean,
    onLongPress?: () => void,
    longPressGuard?: () => boolean,
    onFlick?: (key: any, dx: number, dy: number) => boolean | void,
  },
) => void;

export function useKeyboard() {
  const terminalStore = useTerminalStore();

  function getActiveTerminalTab(): TerminalTab | null {
    const tabs = terminalStore.openTabs;
    const id = terminalStore.activeTabId;
    const tab = tabs.find((t) => t.id === id);
    if (!tab || !tab.term) return null;
    return tab;
  }

  function sendKeyToTerminal(keyDef: KeyDef) {
    // sticky な修飾キー（Shift / Ctrl のトグル状態）が立っていれば自動で付与し、
    // 送信後にクリアする。これでフリックキーバー側の Tab/Space 等にも Shift+
    // が反映される（呼び出し側で keyDef.shift を明示済みなら上書きしない）。
    const merged = { ...keyDef };
    if (merged.shift == null && modifierState.shift) merged.shift = true;
    if (merged.ctrl == null && modifierState.ctrl) merged.ctrl = true;
    dispatchKeyToTab(getActiveTerminalTab(), merged);
    if (modifierState.shift || modifierState.ctrl) clearModifiers();
  }

  function sendTextToTerminal(text: string) {
    dispatchTextToTab(getActiveTerminalTab(), text);
  }

  function scrollTerminal(direction: "up" | "down") {
    const tab = getActiveTerminalTab();
    if (!tab || !tab.term) return;
    tab.term.scrollLines(direction === "up" ? -20 : 20);
  }

  function clearModifiers() {
    modifierState.ctrl = false;
    modifierState.shift = false;
  }

  function setupFlickRepeat(
    el: HTMLElement,
    resolveKey: (dx: number, dy: number, threshold: number) => any,
    onTap?: (() => void) | null,
    opts: {
      accelerateRepeat?: boolean,
      onLongPress?: () => void,
      longPressGuard?: () => boolean,
      onFlick?: (key: any, dx: number, dy: number) => boolean | void,
    } = {},
  ) {
    (attachFlickKey as AttachFlickKey)(el, resolveKey, sendKeyToTerminal, onTap, opts);
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

