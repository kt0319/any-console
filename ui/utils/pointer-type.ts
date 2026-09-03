// 直近のユーザー操作（アプリ全体、ダイアログ等の他要素上の操作も含む）が
// touchだったかを追跡する。TerminalPane.vueのフォーカスガードが、ダイアログの
// ボタンをタップして閉じた直後のタブ切替えなど「対象のターミナル要素自体は
// pointerdownを検知していない」focus()呼び出しでも正しく判定できるよう、
// 要素単位ではなくアプリ全体で最後のpointerTypeを1つだけ保持する。
let lastPointerType = "mouse";

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => { lastPointerType = e.pointerType; },
    { capture: true },
  );
}

export function getLastPointerType() {
  return lastPointerType;
}
