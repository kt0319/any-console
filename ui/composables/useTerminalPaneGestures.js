import { setLongPressActive } from "../stores/terminal.js";
import { createTouchTracker } from "../utils/gesture.js";
import { findUrlInBuffer, getFullBufferText } from "../utils/terminal-buffer-text.js";
import { emit } from "../app-bridge.js";

const LONG_PRESS_URL_MS = 400;

// ターミナル本体のタッチは「長押し（URL 起動 / Select & Copy）」のみ拾う。
// 短いタップやスワイプは何もしない（入力フォーム展開・スクロールバック追従は廃止）。
export function useTerminalPaneGestures({ tab, pillEl }) {
  const paneTouch = createTouchTracker();

  let lastTouchPos = { x: 0, y: 0 };
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
    lastTouchPos = { x: t?.clientX || 0, y: t?.clientY || 0 };
    touchMoved = false;
    cancelLongPressTimer();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (touchMoved) return;
      const url = findUrlInBuffer(tab.value?.term, lastTouchPos.x, lastTouchPos.y);
      if (url) {
        if (navigator.vibrate) navigator.vibrate(40);
        emit("terminal:url", { uri: url });
        return;
      }
      if (navigator.vibrate) navigator.vibrate(40);
      emit("selection:open", { tab: tab.value, fallbackText: getFullBufferText(tab.value?.term) });
    }, LONG_PRESS_URL_MS);
  }

  function onTouchMove(e) {
    if (isOnPill(e.target)) return;
    const { dx, dy } = paneTouch.delta(e);
    if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
      touchMoved = true;
      cancelLongPressTimer();
    }
  }

  function onTouchEnd() {
    cancelLongPressTimer();
  }

  return { onTouchStart, onTouchMove, onTouchEnd };
}
