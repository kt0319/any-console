import type { Ref } from "vue";
import { resolveQwertyVerticalFlick, resolveFnNumberKey } from "../utils/qwerty-key.ts";

// KeyboardInput.vue の defineExpose 相当（呼び出し側では ref(null) のまま渡されるため
// 実体は未確定。使用箇所（isFocused/submit/backspace/appendChar）のみ明示する）。
type KeyboardInputHandle = {
  isFocused?: () => boolean,
  submit?: () => void,
  backspace?: () => void,
  appendChar?: (ch: string) => void,
};

// KeyboardQwertyKey.vue の QwertyKeyDef 相当 + ctrl/shift（onQwertyTap でのマージ用）。
type QwertyKeyDef = {
  label?: string,
  key: string,
  flickUp?: string,
  flickDown?: string,
  noSymbol?: boolean,
  ctrl?: boolean,
  shift?: boolean,
};

type ModifierState = { ctrl: boolean, shift: boolean };

type TouchTarget = HTMLElement & { _touchStartY?: number };

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
}: {
  keyboardInput: Ref<KeyboardInputHandle | null>,
  hasDraft: Ref<boolean>,
  modifierState: ModifierState,
  showSymbolView: Ref<boolean>,
  sendKeyToTerminal: (keyDef: QwertyKeyDef) => void,
  openCamera: () => void,
}) {
  function sendOrType(keyObj: QwertyKeyDef) {
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

  function onQwertyTouchStart(e: TouchEvent) {
    (e.currentTarget as TouchTarget).classList.add("pressed");
    (e.currentTarget as TouchTarget)._touchStartY = e.touches[0].clientY;
  }

  function onQwertyTouchEnd(e: TouchEvent, keyDef: QwertyKeyDef) {
    (e.currentTarget as TouchTarget).classList.remove("pressed");
    const dy = e.changedTouches[0].clientY - ((e.currentTarget as TouchTarget)._touchStartY || 0);
    const flick = resolveQwertyVerticalFlick(dy, keyDef);
    if (flick) {
      if (flick.key) sendOrType({ key: flick.key, label: flick.key });
      return;
    }
    onQwertyTap(keyDef);
  }

  function onQwertyTap(keyDef: QwertyKeyDef) {
    if (keyDef.key === "_camera") { openCamera(); return; }
    if (showSymbolView.value && keyDef.flickUp && !keyDef.noSymbol) {
      sendOrType({ key: keyDef.flickUp, label: keyDef.flickUp });
      return;
    }
    const merged: QwertyKeyDef = { ...keyDef };
    if (modifierState.ctrl) merged.ctrl = true;
    if (modifierState.shift) merged.shift = true;
    sendOrType(merged);
  }

  function onFnNumberTouchStart(e: TouchEvent) {
    (e.currentTarget as TouchTarget).classList.add("pressed");
    (e.currentTarget as TouchTarget)._touchStartY = e.touches[0].clientY;
  }

  function onFnNumberTouchEnd(e: TouchEvent, keyDef: QwertyKeyDef) {
    (e.currentTarget as TouchTarget).classList.remove("pressed");
    const dy = e.changedTouches[0].clientY - ((e.currentTarget as TouchTarget)._touchStartY || 0);
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
