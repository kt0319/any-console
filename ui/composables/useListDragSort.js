import { ref, onBeforeUnmount } from "vue";

/**
 * pointerdown で開始する縦リストのドラッグ並べ替え。
 * hit-detection（DOM位置）で並べ替え先を判定するため、可変高さ行でも安定して動く。
 *
 * @param {object} opts
 * @param {string} opts.rowSelector - 並べ替え対象行を取れるCSSセレクタ
 * @param {(fromIdx:number, toIdx:number) => void} opts.onReorder - 並べ替え確定時のコールバック
 */
export function useListDragSort({ rowSelector, onReorder }) {
  const dragFromIdx = ref(null);
  const dragOverIdx = ref(null);

  function onDragStart(e, idx) {
    e.preventDefault();
    dragFromIdx.value = idx;
    dragOverIdx.value = idx;

    if (e.pointerId != null) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    function onMove(ev) {
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
