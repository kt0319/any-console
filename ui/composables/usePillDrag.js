import { ref } from "vue";
import { useLongPress } from "./useLongPress.js";
import { useSplitDropDrag } from "./useSplitDropDrag.js";
import { useTerminalStore } from "../stores/terminal.js";
import { isPastDragThreshold } from "../utils/gesture.js";
import { DRAG_THRESHOLD, LONG_PRESS_MS, DRAG_STATE_RESET_MS } from "../utils/constants.js";

export function usePillDrag({ tabId, canDrag, frameEl, isViewMode, doEnterViewMode, exitViewMode, onTabClick, onLongPress, emit }) {
  const pillDragging = ref(false);
  const pillMouseLongPress = useLongPress(LONG_PRESS_MS);
  const pillTouchLongPress = useLongPress(LONG_PRESS_MS);
  const terminalStore = useTerminalStore();
  const { beginDrag, updateHover, finishSplitDrop } = useSplitDropDrag();

  let pillTouchStartX = 0;
  let pillTouchStartY = 0;
  let pillTouchDragging = false;
  let pillLongPressed = false;
  let pillMouseDownTime = 0;
  let pillDidDrag = false;
  let pillMouseStartX = 0;
  let pillMouseStartY = 0;
  let pillMouseDragging = false;

  function removePillMouseListeners() {
    document.removeEventListener("mousemove", onPillMouseMove);
    document.removeEventListener("mouseup", onPillMouseUp);
  }

  function onPillMouseDown(e) {
    if (e.button !== 0) return;
    pillMouseDownTime = Date.now();
    pillDidDrag = false;
    pillMouseDragging = false;
    pillMouseStartX = e.clientX;
    pillMouseStartY = e.clientY;
    removePillMouseListeners();
    document.addEventListener("mousemove", onPillMouseMove);
    document.addEventListener("mouseup", onPillMouseUp);
    pillMouseLongPress.start(() => {
      const frame = frameEl.value;
      if (frame && !isViewMode(frame)) doEnterViewMode();
    });
  }

  function onPillClick(e) {
    if (pillTouchLongPress.consumeFired() || pillMouseLongPress.consumeFired()) {
      if (e?.preventDefault) e.preventDefault();
      return;
    }
    const frame = frameEl.value;
    if (frame && isViewMode(frame)) {
      if (e?.preventDefault) e.preventDefault();
      exitViewMode(frame);
      emit("keyboard:deactivate");
      return;
    }
    if (pillDidDrag) {
      pillDidDrag = false;
      return;
    }
    pillMouseLongPress.cancel();
    if (Date.now() - pillMouseDownTime > 300) return;
    onTabClick();
  }

  function onPillMouseMove(e) {
    const dx = e.clientX - pillMouseStartX;
    const dy = e.clientY - pillMouseStartY;
    if (isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
      pillMouseLongPress.cancel();
    }
    if (!canDrag.value) return;
    if (!pillMouseDragging && isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
      pillMouseDragging = true;
      pillDidDrag = true;
      pillDragging.value = true;
      beginDrag(tabId.value);
      e.preventDefault();
    }
    if (pillMouseDragging) {
      e.preventDefault();
      updateHover(e.clientX, e.clientY);
    }
  }

  function onPillMouseUp(e) {
    removePillMouseListeners();
    pillMouseLongPress.cancel();
    if (!pillMouseDragging) return;
    e.preventDefault();
    pillDragging.value = false;
    finishSplitDrop({
      tabId: tabId.value,
      clientX: e.clientX,
      clientY: e.clientY,
      openTabs: terminalStore.openTabs,
      activeTabId: terminalStore.activeTabId,
    });
    setTimeout(() => { pillMouseDragging = false; }, DRAG_STATE_RESET_MS);
  }

  function onPillTouchStart(e) {
    pillTouchDragging = false;
    pillLongPressed = false;
    pillTouchStartX = e.touches[0].clientX;
    pillTouchStartY = e.touches[0].clientY;
    pillTouchLongPress.reset();
    pillTouchLongPress.start(async () => {
      pillLongPressed = true;
      const frame = frameEl.value;
      if (!frame) return;
      if (isViewMode(frame)) {
        exitViewMode(frame);
        emit("keyboard:deactivate");
        return;
      }
      await doEnterViewMode();
    });
  }

  function onPillTouchMove(e) {
    const dx = e.touches[0].clientX - pillTouchStartX;
    const dy = e.touches[0].clientY - pillTouchStartY;
    if (isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
      pillTouchLongPress.cancel();
    }
    if (!canDrag.value) return;
    if (!pillTouchDragging && isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
      pillTouchDragging = true;
      pillDragging.value = true;
      beginDrag(tabId.value);
      if (e.cancelable) e.preventDefault();
    }
    if (pillTouchDragging) {
      if (e.cancelable) e.preventDefault();
      updateHover(e.touches[0].clientX, e.touches[0].clientY);
    }
  }

  function onPillTouchEnd(e) {
    pillTouchLongPress.cancel();
    if (pillLongPressed) {
      pillLongPressed = false;
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!pillTouchDragging) return;
    if (e.cancelable) e.preventDefault();
    pillDidDrag = true;
    pillDragging.value = false;
    const touch = e.changedTouches[0];
    finishSplitDrop({
      tabId: tabId.value,
      clientX: touch.clientX,
      clientY: touch.clientY,
      openTabs: terminalStore.openTabs,
      activeTabId: terminalStore.activeTabId,
    });
    setTimeout(() => { pillTouchDragging = false; }, DRAG_STATE_RESET_MS);
  }

  return {
    pillDragging,
    onPillMouseDown, onPillClick,
    onPillTouchStart, onPillTouchMove, onPillTouchEnd,
  };
}
