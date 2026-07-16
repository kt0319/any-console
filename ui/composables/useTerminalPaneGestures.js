import { setLongPressActive } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { createTouchTracker } from "../utils/gesture.js";
import { findUrlInBuffer } from "../utils/terminal-buffer-text.js";
import { emit } from "../app-bridge.js";
import { CIRCLE_KEYPAD_TRIGGER_PX } from "./useCircleKeyPad.js";

const LONG_PRESS_URL_MS = 400;
const TAP_MAX_DELTA_PX = 10;

// ターミナル本体のタッチは
//   - 長押し: URL 起動
//   - スワイプ: サークルキー（Select & Copy も含む）
//   - 短いタップ: split mode のときだけ pane 選択
// を扱う。
export function useTerminalPaneGestures({ tab, pillEl, circleKeypad, isActive, paneIndex, onSelectPane }) {
  const layoutStore = useLayoutStore();
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
      if (touchMoved || circleKeypad?.state.visible) return;
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
    if (circleKeypad && circleKeypad.enabled) {
      if (!circleKeypad.state.visible && Math.hypot(dx, dy) > CIRCLE_KEYPAD_TRIGGER_PX) {
        circleKeypad.open(startX, startY);
        if (navigator.vibrate) navigator.vibrate(15);
      }
      if (circleKeypad.state.visible) circleKeypad.update(t.clientX, t.clientY);
    }
  }

  function onTouchEnd(e) {
    cancelLongPressTimer();
    if (circleKeypad?.state.visible) {
      circleKeypad.commitAndClose(tab.value);
      return;
    }
    if (!layoutStore.isSplitMode) return;
    if (isActive?.value) return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - startX);
    const dy = Math.abs(t.clientY - startY);
    if (dx > TAP_MAX_DELTA_PX || dy > TAP_MAX_DELTA_PX) return;
    onSelectPane?.(paneIndex?.value);
  }

  function onTouchCancel() {
    cancelLongPressTimer();
    if (circleKeypad?.state.visible) circleKeypad.cancel();
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
