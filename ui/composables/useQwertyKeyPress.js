import { resolveQwertyVerticalFlick, resolveFnNumberKey } from "../utils/qwerty-key.ts";

/**
 * QWERTY キーのタッチ/タップ処理。
 * input にフォーカスがあるときは draft へ、それ以外はターミナルへキーを振り分ける。
 */
export function useQwertyKeyPress({
  keyboardInput,
  hasDraft,
  modifierState,
  showSymbolView,
  sendKeyToTerminal,
  openCamera,
}) {
  function sendOrType(keyObj) {
    // input にフォーカスがあるときは input の draft へ。それ以外はターミナルへ。
    if (keyboardInput.value?.isFocused?.()) {
      const k = keyObj.key;
      if (k === "Enter") {
        if (hasDraft.value) { keyboardInput.value?.submit?.(); } else { sendKeyToTerminal(keyObj); }
        return;
      }
      if (k === "Backspace") { keyboardInput.value?.backspace?.(); return; }
      if (typeof k === "string" && k.length === 1 && !keyObj.ctrl) {
        const ch = (modifierState.shift && /[a-z]/.test(k)) ? k.toUpperCase() : k;
        keyboardInput.value?.appendChar?.(ch);
        return;
      }
      // 制御キー (Ctrl 修飾やファンクション類) はターミナルへ流す
    }
    sendKeyToTerminal(keyObj);
  }

  function onQwertyTouchStart(e) {
    e.currentTarget.classList.add("pressed");
    e.currentTarget._touchStartY = e.touches[0].clientY;
  }

  function onQwertyTouchEnd(e, keyDef) {
    e.currentTarget.classList.remove("pressed");
    const dy = e.changedTouches[0].clientY - (e.currentTarget._touchStartY || 0);
    const flick = resolveQwertyVerticalFlick(dy, keyDef);
    if (flick) {
      if (flick.key) sendOrType({ key: flick.key, label: flick.key });
      return;
    }
    onQwertyTap(keyDef);
  }

  function onQwertyTap(keyDef) {
    if (keyDef.key === "_camera") { openCamera(); return; }
    if (showSymbolView.value && keyDef.flickUp && !keyDef.noSymbol) {
      sendOrType({ key: keyDef.flickUp, label: keyDef.flickUp });
      return;
    }
    const merged = { ...keyDef };
    if (modifierState.ctrl) merged.ctrl = true;
    if (modifierState.shift) merged.shift = true;
    sendOrType(merged);
  }

  function onFnNumberTouchStart(e) {
    e.currentTarget.classList.add("pressed");
    e.currentTarget._touchStartY = e.touches[0].clientY;
  }

  function onFnNumberTouchEnd(e, keyDef) {
    e.currentTarget.classList.remove("pressed");
    const dy = e.changedTouches[0].clientY - (e.currentTarget._touchStartY || 0);
    sendKeyToTerminal({ key: resolveFnNumberKey(dy, keyDef) });
  }

  return {
    sendOrType,
    onQwertyTouchStart,
    onQwertyTouchEnd,
    onQwertyTap,
    onFnNumberTouchStart,
    onFnNumberTouchEnd,
  };
}
