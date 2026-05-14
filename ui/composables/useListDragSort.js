import { ref, onBeforeUnmount } from "vue";

/**
 * mousedown/touchstart で開始する縦リストのドラッグ並べ替え。
 *
 * @param {object} opts
 * @param {string} opts.rowSelector - 並べ替え対象行を取れるCSSセレクタ
 * @param {(fromIdx:number, toIdx:number) => void} opts.onReorder - 並べ替え確定時のコールバック
 */
export function useListDragSort({ rowSelector, onReorder }) {
  const dragFromIdx = ref(null);
  const dragOverIdx = ref(null);

  function onDragStart(e, idx) {
    dragFromIdx.value = idx;
    dragOverIdx.value = idx;
    const isTouch = e.type === "touchstart";
    const moveEvent = isTouch ? "touchmove" : "mousemove";
    const endEvent = isTouch ? "touchend" : "mouseup";

    function onMove(ev) {
      const y = isTouch ? ev.touches[0].clientY : ev.clientY;
      const rows = document.querySelectorAll(rowSelector);
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) {
          dragOverIdx.value = i;
          break;
        }
      }
      if (isTouch) ev.preventDefault();
    }

    function onEnd() {
      document.removeEventListener(moveEvent, onMove, { passive: false });
      document.removeEventListener(endEvent, onEnd);
      if (
        dragFromIdx.value !== null
        && dragOverIdx.value !== null
        && dragFromIdx.value !== dragOverIdx.value
      ) {
        onReorder(dragFromIdx.value, dragOverIdx.value);
      }
      dragFromIdx.value = null;
      dragOverIdx.value = null;
    }

    document.addEventListener(moveEvent, onMove, { passive: false });
    document.addEventListener(endEvent, onEnd);
  }

  onBeforeUnmount(() => {
    dragFromIdx.value = null;
    dragOverIdx.value = null;
  });

  return { dragFromIdx, dragOverIdx, onDragStart };
}
