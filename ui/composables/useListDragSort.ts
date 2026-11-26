import { ref, onBeforeUnmount } from "vue";

/** pointerdown 開始の縦リストドラッグ並べ替え。DOM 位置の hit-detection で判定するため可変高さ行でも安定する。 */
export function useListDragSort({ rowSelector, onReorder }: {
  rowSelector: string,
  onReorder: (fromIdx: number, toIdx: number) => void,
}) {
  const dragFromIdx = ref<number | null>(null);
  const dragOverIdx = ref<number | null>(null);

  function onDragStart(e: PointerEvent, idx: number) {
    e.preventDefault();
    dragFromIdx.value = idx;
    dragOverIdx.value = idx;

    if (e.pointerId != null) {
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    function onMove(ev: PointerEvent) {
      const rows = document.querySelectorAll(rowSelector);
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
          dragOverIdx.value = i;
          break;
        }
      }
    }

    function onEnd() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onEnd);
      document.removeEventListener("pointercancel", onEnd);
      if (dragFromIdx.value !== null && dragOverIdx.value !== null && dragFromIdx.value !== dragOverIdx.value) {
        onReorder(dragFromIdx.value, dragOverIdx.value);
      }
      dragFromIdx.value = null;
      dragOverIdx.value = null;
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
  }

  onBeforeUnmount(() => {
    dragFromIdx.value = null;
    dragOverIdx.value = null;
  });

  return { dragFromIdx, dragOverIdx, onDragStart };
}
