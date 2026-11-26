import { isComposingEvent } from "./keyboard-event.ts";

// タッチデバイス（hover 不可・粗いポインタ）判定。自動フォーカスを抑制しソフトキーボードの誤起動を防ぐ。
export function isTouchOnly() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
}

export function isCaretOnFirstLine(value: string, selectionStart: number | null | undefined): boolean {
  return !value.slice(0, selectionStart ?? 0).includes("\n");
}

export function isCaretOnLastLine(value: string, selectionEnd: number | null | undefined): boolean {
  return !value.slice(selectionEnd ?? value.length).includes("\n");
}

// document に Escape の capture リスナーを登録し、解除関数を返す。
// stopPropagation しないと Escape が ESC バイトとして xterm.js へ届き、シェルのZLEが次の1文字をメタキー結合として欠落させる。
export function listenForEscape(handler: (e: KeyboardEvent) => void) {
  const onKeydown = (e: KeyboardEvent) => {
    // IME 変換中の Esc は変換の取消なので、ダイアログを閉じず IME に任せる
    if (e.key === "Escape" && !isComposingEvent(e)) {
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    }
  };
  document.addEventListener("keydown", onKeydown, true);
  return () => document.removeEventListener("keydown", onKeydown, true);
}
