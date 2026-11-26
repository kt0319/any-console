// 直近の操作が touch だったかをアプリ全体で1つ保持する。TerminalPane.vue のフォーカスガードが、
// ダイアログ操作直後など対象要素が pointerdown を検知していない focus() でも判定できるようにするため。
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
