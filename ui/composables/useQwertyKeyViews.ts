import { ref, watch } from "vue";
import { emit } from "../app-bridge.js";
import { createFlickHandlers } from "../utils/flick-handlers.ts";

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
}) {
  const showFnView = ref(false);
  const showSymbolView = ref(false);

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
      showSymbolView.value = false;
      closeSnippetView();
    }
  }

  function sendSpace() { sendKeyToTerminal({ key: " " }); }

  function doRefresh() {
    const tab = getActiveTerminalTab();
    if (tab) emit("tab:refresh", { tab });
  }

  const fnFlick = createFlickHandlers({ up: doRefresh, down: onReload, tap: toggleFnView });

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
    showSymbolView,
    toggleShift,
    toggleCtrl,
    toggleFnView,
    sendSpace,
    shiftFlick,
    ctrlFlick,
    spaceFlick,
    fnFlick,
  };
}
