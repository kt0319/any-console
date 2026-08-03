import { ref } from "vue";
import { isPastDragThreshold } from "../utils/gesture.js";
import { DRAG_THRESHOLD, DRAG_STATE_RESET_MS } from "../utils/constants.js";

// ワークスペースピルを縦方向にドラッグして、ピル群（.pill-group）の画面上の
// 位置（top/bottom）を切り替える。ドラッグ中は呼び出し側が dragOffsetY を
// transform: translateY() に反映して見た目だけ追従させ、離した時点の指/
// マウスのY座標を onReposition に渡して実際の切替判定（画面の上半分/下半分
// どちらで離したか）を委ねる。
export function usePillDrag({ canDrag, onTabClick, onReposition }) {
  const pillDragging = ref(false);
  const dragOffsetY = ref(0);

  let pillTouchStartY = 0;
  let pillTouchDragging = false;
  let pillMouseDownTime = 0;
  let pillDidDrag = false;
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
    pillMouseStartY = e.clientY;
    removePillMouseListeners();
    document.addEventListener("mousemove", onPillMouseMove);
    document.addEventListener("mouseup", onPillMouseUp);
  }

  function onPillClick(e) {
    if (pillDidDrag) {
      pillDidDrag = false;
      return;
    }
    if (Date.now() - pillMouseDownTime > 300) return;
    onTabClick();
  }

  function onPillMouseMove(e) {
    if (!canDrag.value) return;
    const dy = e.clientY - pillMouseStartY;
    if (!pillMouseDragging && isPastDragThreshold(dy, 0, DRAG_THRESHOLD)) {
      pillMouseDragging = true;
      pillDidDrag = true;
      pillDragging.value = true;
      e.preventDefault();
    }
    if (pillMouseDragging) {
      e.preventDefault();
      dragOffsetY.value = dy;
    }
  }

  function onPillMouseUp(e) {
    removePillMouseListeners();
    if (!pillMouseDragging) return;
    e.preventDefault();
    pillDragging.value = false;
    onReposition?.(e.clientY);
    dragOffsetY.value = 0;
    setTimeout(() => { pillMouseDragging = false; }, DRAG_STATE_RESET_MS);
  }

  function onPillTouchStart(e) {
    pillTouchDragging = false;
    pillTouchStartY = e.touches[0].clientY;
  }

  function onPillTouchMove(e) {
    if (!canDrag.value) return;
    const dy = e.touches[0].clientY - pillTouchStartY;
    if (!pillTouchDragging && isPastDragThreshold(dy, 0, DRAG_THRESHOLD)) {
      pillTouchDragging = true;
      pillDragging.value = true;
      if (e.cancelable) e.preventDefault();
    }
    if (pillTouchDragging) {
      if (e.cancelable) e.preventDefault();
      dragOffsetY.value = dy;
    }
  }

  function onPillTouchEnd(e) {
    if (!pillTouchDragging) return;
    if (e.cancelable) e.preventDefault();
    pillDidDrag = true;
    pillDragging.value = false;
    const touch = e.changedTouches[0];
    onReposition?.(touch.clientY);
    dragOffsetY.value = 0;
    setTimeout(() => { pillTouchDragging = false; }, DRAG_STATE_RESET_MS);
  }

  return {
    pillDragging,
    dragOffsetY,
    onPillMouseDown, onPillClick,
    onPillTouchStart, onPillTouchMove, onPillTouchEnd,
  };
}
