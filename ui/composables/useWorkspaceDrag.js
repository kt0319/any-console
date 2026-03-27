import { ref } from "vue";

export function useWorkspaceDrag({ items, listEl, onReorder }) {
  const dragIdx = ref(-1);
  const dragOffsetY = ref(0);
  let dragStartY = 0;
  let dragRowHeight = 0;
  let dragDidMove = false;

  function onDragStart(e, idx) {
    if (items.value.length < 2) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const list = listEl.value;
    if (!list) return;
    const rows = list.querySelectorAll(".ws-check-item");
    dragRowHeight = rows[0]?.getBoundingClientRect().height || 40;
    dragStartY = clientY;
    dragIdx.value = idx;
    dragOffsetY.value = 0;
    dragDidMove = false;
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    document.addEventListener("touchmove", onDragMove, { passive: false });
    document.addEventListener("touchend", onDragEnd);
    document.addEventListener("touchcancel", onDragEnd);
  }

  function onDragMove(e) {
    if (dragIdx.value < 0) return;
    if (e.cancelable) e.preventDefault();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = clientY - dragStartY;
    dragOffsetY.value = dy;

    const steps = Math.round(dy / dragRowHeight);
    if (steps === 0) return;
    const newIdx = Math.max(0, Math.min(dragIdx.value + steps, items.value.length - 1));
    if (newIdx === dragIdx.value) return;

    const arr = items.value;
    const [moved] = arr.splice(dragIdx.value, 1);
    arr.splice(newIdx, 0, moved);
    dragIdx.value = newIdx;
    dragStartY = clientY;
    dragOffsetY.value = 0;
    dragDidMove = true;
  }

  function onDragEnd() {
    cleanup();
    if (dragDidMove) {
      onReorder();
    }
  }

  function cleanup() {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.removeEventListener("touchmove", onDragMove);
    document.removeEventListener("touchend", onDragEnd);
    document.removeEventListener("touchcancel", onDragEnd);
    dragIdx.value = -1;
    dragOffsetY.value = 0;
  }

  return {
    dragIdx,
    dragOffsetY,
    onDragStart,
    cleanup,
  };
}
