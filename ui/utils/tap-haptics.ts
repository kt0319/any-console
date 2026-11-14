import { TAP_VIBRATE_MS } from "./constants.ts";

const TAP_TARGET_SELECTOR = "button:not(:disabled), [role='button'], .quick-key";

export function vibrateForTapTarget(target: EventTarget | null) {
  if (!navigator.vibrate) return;
  if (!(target instanceof Element)) return;
  if (!target.closest(TAP_TARGET_SELECTOR)) return;
  navigator.vibrate(TAP_VIBRATE_MS);
}

// キーの多くは touchstart.prevent で処理され click が発火しないため、
// 個別ハンドラに依らず capture で touchstart を受けて一括で振動させる。
export function installTapHaptics() {
  document.addEventListener("touchstart", (e) => vibrateForTapTarget(e.target), { capture: true, passive: true });
}
