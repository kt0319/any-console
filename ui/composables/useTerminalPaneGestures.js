import { setLongPressActive } from "../stores/terminal.js";
import { createTouchTracker } from "../utils/gesture.js";
import { findUrlInBuffer } from "../utils/terminal-buffer-text.js";
import { emit } from "../app-bridge.js";
import { RADIAL_TRIGGER_PX } from "./useRadialKey.js";

const LONG_PRESS_URL_MS = 400;

// ターミナル本体のタッチは
//   - 長押し: URL 起動
//   - スワイプ: サークルキー（Select & Copy も含む）
// だけを扱う。短いタップ・縦スクロールは何もしない。
export function useTerminalPaneGestures({ tab, pillEl, radial }) {
  const paneTouch = createTouchTracker();

  let startX = 0;
  let startY = 0;
  let touchMoved = false;
  let longPressTimer = null;

  function cancelLongPressTimer() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function isOnPill(target) {
    return pillEl.value && pillEl.value.contains(target);
  }

  function onTouchStart(e) {
    if (isOnPill(e.target)) return;
    paneTouch.start(e);
    setLongPressActive(false);
    const t = e.touches?.[0];
    startX = t?.clientX || 0;
    startY = t?.clientY || 0;
    touchMoved = false;
    cancelLongPressTimer();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (touchMoved || radial?.state.visible) return;
      const url = findUrlInBuffer(tab.value?.term, startX, startY);
      if (!url) return;
      if (navigator.vibrate) navigator.vibrate(40);
      emit("terminal:url", { uri: url });
    }, LONG_PRESS_URL_MS);
  }

  function onTouchMove(e) {
    if (isOnPill(e.target)) return;
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!touchMoved && Math.hypot(dx, dy) > 20) {
      touchMoved = true;
      cancelLongPressTimer();
    }
    if (radial) {
      if (!radial.state.visible && Math.hypot(dx, dy) > RADIAL_TRIGGER_PX) {
        radial.open(startX, startY);
        if (navigator.vibrate) navigator.vibrate(15);
      }
      if (radial.state.visible) radial.update(t.clientX, t.clientY);
    }
  }

  function onTouchEnd() {
    cancelLongPressTimer();
    if (radial?.state.visible) radial.commitAndClose(tab.value);
  }

  function onTouchCancel() {
    cancelLongPressTimer();
    if (radial?.state.visible) radial.cancel();
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
