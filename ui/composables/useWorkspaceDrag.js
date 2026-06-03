import { ref } from "vue";

export function useWorkspaceDrag({ items, listEl, onReorder, rowSelector = ".ws-check-item, .picker-ws-group" }) {
  const dragIdx = ref(-1);
  const dragOffsetY = ref(0);
  const isDragging = ref(false);
  const dragItems = ref(/** @type {any[]|null} */ (null));

  let dragStartY = 0;
  let dragRowHeight = 0;
  let dragDidMove = false;

  function onDragStart(e, idx) {
    if (items.value.length < 2) return;

    const list = listEl.value;
    if (!list) return;

    if (navigator.vibrate) navigator.vibrate(30);

    dragItems.value = [...items.value];
    const rows = list.querySelectorAll(rowSelector);
    dragRowHeight = rows[idx]?.getBoundingClientRect().height || rows[0]?.getBoundingClientRect().height || 44;
    dragStartY = e.clientY ?? e.touches?.[0]?.clientY;
    dragIdx.value = idx;
    dragOffsetY.value = 0;
    dragDidMove = false;
    isDragging.value = true;

    // ハンドルでポインターキャプチャしてスクロールを防ぐ
    if (e.pointerId != null) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    document.addEventListener("pointermove", _onDragMove);
    document.addEventListener("pointerup", _onDragEnd);
    document.addEventListener("pointercancel", _onDragEnd);
    // touch fallback
    document.addEventListener("touchmove", _onTouchMove, { passive: false });
    document.addEventListener("touchend", _onDragEnd);
    document.addEventListener("touchcancel", _onDragEnd);
  }

  function _onDragMove(e) {
    if (dragIdx.value < 0) return;
    _applyMove(e.clientY);
  }

  function _onTouchMove(e) {
    if (dragIdx.value < 0) return;
    if (e.cancelable) e.preventDefault();
    _applyMove(e.touches[0].clientY);
  }

  function _applyMove(clientY) {
    const dy = clientY - dragStartY;
    dragOffsetY.value = dy;

    const steps = Math.trunc(dy / dragRowHeight);
    if (steps === 0) return;
    const arr = dragItems.value;
    if (!arr) return;
    const newIdx = Math.max(0, Math.min(dragIdx.value + steps, arr.length - 1));
    if (newIdx === dragIdx.value) return;

    const [moved] = arr.splice(dragIdx.value, 1);
    arr.splice(newIdx, 0, moved);
    dragIdx.value = newIdx;
    dragStartY = clientY;
    dragOffsetY.value = 0;
    dragDidMove = true;
  }

  function _onDragEnd() {
    const moved = dragDidMove;
    const finalItems = dragItems.value ? [...dragItems.value] : null;
    cleanup();
    if (moved && finalItems) onReorder(finalItems);
  }

  function cleanup() {
    document.removeEventListener("pointermove", _onDragMove);
    document.removeEventListener("pointerup", _onDragEnd);
    document.removeEventListener("pointercancel", _onDragEnd);
    document.removeEventListener("touchmove", _onTouchMove);
    document.removeEventListener("touchend", _onDragEnd);
    document.removeEventListener("touchcancel", _onDragEnd);
    dragIdx.value = -1;
    dragOffsetY.value = 0;
    isDragging.value = false;
    dragItems.value = null;
    dragDidMove = false;
  }

  function isSuppressingClick() { return false; }

  return {
    dragIdx,
    dragOffsetY,
    isDragging,
    dragItems,
    onDragStart,
    onLongPressStart: onDragStart, // 後方互換
    isSuppressingClick,
    cleanup,
  };
}
