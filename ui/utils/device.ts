// 入力デバイス判定（純関数）。
// utils/keyboard.ts の isTouchOnly() が「ソフトキーボードの誤起動を避けるべき端末か」
// （hover:none + pointer:coarse）を見るのに対し、こちらは「主にタッチで操作する端末か」
// （ドラッグ可否・タッチ選択などの入力モダリティ判定）を見る。ハイブリッド端末で
// 両者は一致しないため、統合せず用途で使い分ける。
export function isTouchInput() {
  return typeof window !== "undefined"
    && !window.matchMedia("(pointer: fine)").matches
    && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}

// スマートフォン/タブレットのUAらしさの判定（QRペアリングの導線 - ScreenEmpty.vue -
// が「既にモバイル端末をペアリング済みか」を /devices の user_agent から判定する用途）。
// server/src/devices.rs の autoname_from_user_agent と判定対象は同じだが、真偽値だけで
// 十分なためこちらは独立した軽量実装とする。
const MOBILE_UA_MARKERS = ["iPhone", "iPad", "Android", "Mobile"];

export function isMobileUserAgent(userAgent: string): boolean {
  const ua = userAgent || "";
  return MOBILE_UA_MARKERS.some((marker) => ua.includes(marker));
}
