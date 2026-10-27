/** 修飾キー単独の押下を無視するための集合。 */
export const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * IME 変換中の keydown イベントかを判定する。
 * 変換中はキー処理を素通しして IME の挙動を妨げない。
 * @param composingFlag コンポーネント側で保持している composition state
 */
export function isComposingEvent(e: KeyboardEvent, composingFlag: boolean = false) {
  return !!(composingFlag || e?.isComposing || e?.keyCode === 229);
}

/**
 * キー操作（Enter 送信・Esc 取消など）を IME 変換中でないときだけ実行する。
 * 変換確定の Enter / 変換取消の Esc をアプリ側で処理すると、入力欄に確定前の
 * 文字列のまま送信・クローズされ、日本語入力が成立しないため。
 * 変換中は preventDefault もしない（IME の挙動を妨げない）。
 */
export function runUnlessComposing(e: KeyboardEvent, action: () => void) {
  if (isComposingEvent(e)) return;
  e.preventDefault();
  action();
}

/**
 * 物理（外付け）キーボード由来の keydown かを判定する。
 * KeyboardEvent.code は物理キー由来のときだけ "KeyA"/"Enter"/"Backspace" 等の
 * 値を持つ。iOS Safari のソフトキーボード由来は "" や "Unidentified" になる。
 */
export function isHardwareKeyboardEvent(e: KeyboardEvent | null | undefined): boolean {
  return !!e?.code && e.code !== "Unidentified";
}
