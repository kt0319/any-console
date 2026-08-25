import type { ComputedRef } from "vue";
import { ref, watch } from "vue";
import { emit } from "../app-bridge.ts";
import { createFlickHandlers } from "../utils/flick-handlers.ts";
import type { TerminalTab } from "../stores/terminal.ts";

type ModifierState = { ctrl: boolean, shift: boolean };
type KeyDef = { key: string, ctrl?: boolean, shift?: boolean };

/**
 * QWERTY パネルの表示モード (shift / ctrl / 記号 / fn) と
 * 修飾キー列 (shift / ctrl / space / fn) のフリック操作をまとめる。
 */
export function useQwertyKeyViews({
  modifierState,
  showSnippetView,
  dismissSnippetView,
  closeSnippetView,
  sendKeyToTerminal,
  getActiveTerminalTab,
  onReload,
}: {
  modifierState: ModifierState,
  showSnippetView: ComputedRef<boolean>,
  dismissSnippetView: () => void,
  closeSnippetView: () => void,
  sendKeyToTerminal: (keyDef: KeyDef) => void,
  getActiveTerminalTab: () => TerminalTab | null,
  onReload: () => void,
}) {
  const showFnView = ref(false);

  watch(showSnippetView, (val) => { if (val) showFnView.value = false; });

  function toggleShift() {
    dismissSnippetView();
    modifierState.shift = !modifierState.shift;
    if (modifierState.shift) { showFnView.value = false; }
  }

  function toggleCtrl() {
    dismissSnippetView();
    modifierState.ctrl = !modifierState.ctrl;
    if (modifierState.ctrl) showFnView.value = false;
  }

  function toggleFnView() {
    showFnView.value = !showFnView.value;
    if (showFnView.value) {
      modifierState.shift = false;
      modifierState.ctrl = false;
      closeSnippetView();
    }
  }

  function sendSpace() { sendKeyToTerminal({ key: " " }); }

  function doRefresh() {
    const tab = getActiveTerminalTab();
    if (tab) emit("tab:refresh", { tab });
  }

  const shiftFlick = createFlickHandlers({
    up: doRefresh,
    down: onReload,
    left: () => sendKeyToTerminal({ key: "u", ctrl: true }),
    right: () => sendKeyToTerminal({ key: "k", ctrl: true }),
    tap: toggleShift,
  });

  const ctrlFlick = createFlickHandlers({
    up: () => sendKeyToTerminal({ key: "c", ctrl: true }),
    down: () => sendKeyToTerminal({ key: "o", ctrl: true }),
    left: () => sendKeyToTerminal({ key: "l", ctrl: true }),
    right: () => sendKeyToTerminal({ key: "r", ctrl: true }),
    tap: toggleCtrl,
  });

  const spaceFlick = createFlickHandlers({
    up: () => sendKeyToTerminal({ key: "PageUp" }),
    down: () => sendKeyToTerminal({ key: "PageDown" }),
    left: () => sendKeyToTerminal({ key: "Home" }),
    right: () => sendKeyToTerminal({ key: "End" }),
    tap: sendSpace,
  });

  return {
    showFnView,
    toggleShift,
    toggleCtrl,
    toggleFnView,
    sendSpace,
    shiftFlick,
    ctrlFlick,
    spaceFlick,
  };
}
