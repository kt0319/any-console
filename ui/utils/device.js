// 入力デバイス判定（純関数）。
// utils/keyboard.js の isTouchOnly() が「ソフトキーボードの誤起動を避けるべき端末か」
// （hover:none + pointer:coarse）を見るのに対し、こちらは「主にタッチで操作する端末か」
// （ドラッグ可否・タッチ選択などの入力モダリティ判定）を見る。ハイブリッド端末で
// 両者は一致しないため、統合せず用途で使い分ける。
export function isTouchInput() {
  return typeof window !== "undefined"
    && !window.matchMedia("(pointer: fine)").matches
    && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}
