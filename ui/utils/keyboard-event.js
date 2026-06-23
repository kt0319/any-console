/** 修飾キー単独の押下を無視するための集合。 */
export const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * IME 変換中の keydown イベントかを判定する。
 * 変換中はキー処理を素通しして IME の挙動を妨げない。
 * @param {KeyboardEvent} e
 * @param {boolean} [composingFlag] コンポーネント側で保持している composition state
 */
export function isComposingEvent(e, composingFlag = false) {
  return !!(composingFlag || e?.isComposing || e?.keyCode === 229);
}

/**
 * 物理（外付け）キーボード由来の keydown かを判定する。
 * KeyboardEvent.code は物理キー由来のときだけ "KeyA"/"Enter"/"Backspace" 等の
 * 値を持つ。iOS Safari のソフトキーボード由来は "" や "Unidentified" になる。
 */
export function isHardwareKeyboardEvent(e) {
  return !!e?.code && e.code !== "Unidentified";
}
