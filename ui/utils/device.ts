// keyboard.ts の isTouchOnly()（hover:none + pointer:coarse）とはハイブリッド端末で一致しないため統合しない。
export function isTouchInput() {
  return typeof window !== "undefined"
    && !window.matchMedia("(pointer: fine)").matches
    && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}

// server/src/devices.rs の autoname_from_user_agent と判定対象は同じ。真偽値だけ欲しいので独立実装にしている。
const MOBILE_UA_MARKERS = ["iPhone", "iPad", "Android", "Mobile"];

export function isMobileUserAgent(userAgent: string): boolean {
  const ua = userAgent || "";
  return MOBILE_UA_MARKERS.some((marker) => ua.includes(marker));
}

// metaKey の呼び名が OS ごとに違う（Mac=⌘ / Windows=Win / Linux=Super）ため表記だけ切り替える。
export function globalShortcutLabel(key: string, userAgent: string): string {
  const ua = userAgent || "";
  if (/Mac|iPhone|iPad/.test(ua)) return `⌘⇧${key}`;
  if (ua.includes("Windows")) return `Win+Shift+${key}`;
  return `Super+Shift+${key}`;
}
