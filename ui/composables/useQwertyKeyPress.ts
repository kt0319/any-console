import { resolveQwertyVerticalFlick, resolveFnNumberKey } from "../utils/qwerty-key.ts";

// KeyboardQwertyKey.vue の QwertyKeyDef 相当 + ctrl/shift（onQwertyTap でのマージ用）。
type QwertyKeyDef = {
  label?: string,
  key: string,
  flickUp?: string,
  flickDown?: string,
  ctrl?: boolean,
  shift?: boolean,
};

type ModifierState = { ctrl: boolean, shift: boolean };

type TouchTarget = HTMLElement & { _touchStartY?: number };

/**
 * QWERTY キーのタッチ/タップ処理。縦フリック判定と修飾キーのマージを行い、
 * キーをターミナルへ送る。
 */
export function useQwertyKeyPress({
  modifierState,
  sendKeyToTerminal,
  openCamera,
}: {
  modifierState: ModifierState,
  sendKeyToTerminal: (keyDef: QwertyKeyDef) => void,
  openCamera: () => void,
}) {
  function onQwertyTouchStart(e: TouchEvent) {
    (e.currentTarget as TouchTarget).classList.add("pressed");
    (e.currentTarget as TouchTarget)._touchStartY = e.touches[0].clientY;
  }

  function onQwertyTouchEnd(e: TouchEvent, keyDef: QwertyKeyDef) {
    (e.currentTarget as TouchTarget).classList.remove("pressed");
    const dy = e.changedTouches[0].clientY - ((e.currentTarget as TouchTarget)._touchStartY || 0);
    const flick = resolveQwertyVerticalFlick(dy, keyDef);
    if (flick) {
      if (flick.key) sendKeyToTerminal({ key: flick.key, label: flick.key });
      return;
    }
    onQwertyTap(keyDef);
  }

  function onQwertyTap(keyDef: QwertyKeyDef) {
    if (keyDef.key === "_camera") { openCamera(); return; }
    const merged: QwertyKeyDef = { ...keyDef };
    if (modifierState.ctrl) merged.ctrl = true;
    if (modifierState.shift) merged.shift = true;
    sendKeyToTerminal(merged);
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
    onQwertyTouchStart,
    onQwertyTouchEnd,
    onQwertyTap,
    onFnNumberTouchStart,
    onFnNumberTouchEnd,
  };
}
