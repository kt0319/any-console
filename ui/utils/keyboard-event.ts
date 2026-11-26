export const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/** IME 変換中の keydown かを判定する。 */
export function isComposingEvent(e: KeyboardEvent, composingFlag: boolean = false) {
  return !!(composingFlag || e?.isComposing || e?.keyCode === 229);
}

/** キー操作を IME 変換中でない時だけ実行する。変換確定の Enter / 取消の Esc を処理すると未確定のまま送信・クローズされるため。 */
export function runUnlessComposing(e: KeyboardEvent, action: () => void) {
  if (isComposingEvent(e)) return;
  e.preventDefault();
  action();
}

/** 物理キーボード由来の keydown か。KeyboardEvent.code は物理キーのみ "KeyA" 等を持ち、iOS Safari のソフトキーボードは "" か "Unidentified" になる。 */
export function isHardwareKeyboardEvent(e: KeyboardEvent | null | undefined): boolean {
  return !!e?.code && e.code !== "Unidentified";
}
