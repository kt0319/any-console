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
        // 分割中、非アクティブペインでサークルキーパッドを開いた場合は、
        // 操作対象がどのペインか分かるようそのペインをアクティブにする。
        if (layoutStore.isSplitMode && !isActive?.value) onSelectPane?.(paneIndex?.value);
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

  // PC向け: 右クリック+ドラッグでもサークルキーパッドを開けるようにする
  // （タッチのスワイプに相当）。右クリック自体はブラウザのコンテキストメニューを
  // 出したいことが無いこの用途では常に抑止する（isOnPill時は素通しし、ピル自身の
  // 右クリックは通常通り扱えるようにする）。
  let mouseStartX = 0;
  let mouseStartY = 0;
  let onMouseMove = null;
  let onMouseUp = null;

  function onContextMenu(e) {
    if (isOnPill(e.target)) return;
    e.preventDefault();
  }

  function onMouseDown(e) {
    if (e.button !== 2 || isOnPill(e.target)) return;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;

    onMouseMove = (ev) => {
      if (!circleKeypad || !circleKeypad.enabled) return;
      const dx = ev.clientX - mouseStartX;
      const dy = ev.clientY - mouseStartY;
      if (!circleKeypad.state.visible && Math.hypot(dx, dy) > CIRCLE_KEYPAD_TRIGGER_PX) {
        if (layoutStore.isSplitMode && !isActive?.value) onSelectPane?.(paneIndex?.value);
        circleKeypad.open(mouseStartX, mouseStartY);
      }
      if (circleKeypad.state.visible) circleKeypad.update(ev.clientX, ev.clientY);
    };
    onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      onMouseMove = null;
      onMouseUp = null;
      if (circleKeypad?.state.visible) circleKeypad.commitAndClose(tab.value);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu, onMouseDown };
}
