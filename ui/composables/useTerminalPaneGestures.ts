import type { Ref } from "vue";
import { setLongPressActive } from "../stores/terminal.ts";
import type { TerminalTab } from "../stores/terminal.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { createTouchTracker } from "../utils/gesture.ts";
import { findUrlInBuffer } from "../utils/terminal-buffer-text.ts";
import { emit } from "../app-bridge.ts";
import { CIRCLE_KEYPAD_TRIGGER_PX } from "./useCircleKeypad.ts";
import { LONG_PRESS_URL_MS, TAP_MAX_DELTA_PX } from "../utils/constants.ts";

// useCircleKeypad() の戻り値のうち、このジェスチャ処理が利用する部分。
interface CircleKeypadLike {
  enabled: Ref<boolean>;
  state: { visible: boolean };
  open: (x: number, y: number) => void;
  update: (x: number, y: number) => void;
  commitAndClose: (tab: TerminalTab | null | undefined) => void;
  cancel: () => void;
}

// ターミナル本体のタッチは
//   - 長押し: URL 起動
//   - スワイプ: サークルキー（Select & Copy も含む）
//   - 短いタップ: split mode のときだけ pane 選択
// を扱う。
export function useTerminalPaneGestures({ tab, pillEl, circleKeypad, isActive, paneIndex, onSelectPane }: {
  tab: Ref<TerminalTab | null | undefined>,
  pillEl: Ref<HTMLElement | null>,
  circleKeypad?: CircleKeypadLike | null,
  isActive?: Ref<boolean> | null,
  paneIndex?: Ref<number> | null,
  onSelectPane?: ((index: number | undefined) => void) | null,
}) {
  const layoutStore = useLayoutStore();
  const paneTouch = createTouchTracker();

  let startX = 0;
  let startY = 0;
  let touchMoved = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelLongPressTimer() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function isOnPill(target: EventTarget | null) {
    return pillEl.value && pillEl.value.contains(target as Node | null);
  }

  function onTouchStart(e: TouchEvent) {
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

  function onTouchMove(e: TouchEvent) {
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

  function onTouchEnd(e: TouchEvent) {
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
  let onMouseMove: ((ev: MouseEvent) => void) | null = null;
  let onMouseUp: (() => void) | null = null;

  function onContextMenu(e: MouseEvent) {
    if (isOnPill(e.target)) return;
    e.preventDefault();
  }

  function onMouseDown(e: MouseEvent) {
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
      document.removeEventListener("mousemove", onMouseMove!);
      document.removeEventListener("mouseup", onMouseUp!);
      onMouseMove = null;
      onMouseUp = null;
      if (circleKeypad?.state.visible) circleKeypad.commitAndClose(tab.value);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu, onMouseDown };
}
