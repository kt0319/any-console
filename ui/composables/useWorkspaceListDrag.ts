import { ref } from "vue";
import type { Ref, ComputedRef } from "vue";

type FlatRow = { type: string } & Record<string, any>;

// ヘッダー行を飛び越えて ws 行同士を入れ替える
export function useWorkspaceListDrag({ flatList, listEl, onReorder, rowSelector = ".ws-list-item" }: {
  flatList: ComputedRef<FlatRow[]>,
  listEl: Ref<HTMLElement | null>,
  onReorder: (finalList: FlatRow[]) => Promise<void> | void,
  rowSelector?: string,
}) {
  const dragIdx = ref(-1);
  const dragOffsetY = ref(0);
  const dragFlatList = ref<FlatRow[] | null>(null);

  let _dragStartY = 0;
  let _dragRowHeight = 0;
  let _dragDidMove = false;

  function onDragStart(e: PointerEvent | TouchEvent, flatIdx: number) {
    const fl = flatList.value;
    if (fl.filter((item) => item.type === "ws").length < 2) return;
    const list = listEl.value;
    if (!list) return;

    if (navigator.vibrate) navigator.vibrate(30);

    dragFlatList.value = fl.map((item) => ({ ...item }));
    const rows = list.querySelectorAll(rowSelector);
    _dragRowHeight = rows[0]?.getBoundingClientRect().height || 44;
    _dragStartY = (e as PointerEvent).clientY ?? (e as TouchEvent).touches?.[0]?.clientY;
    dragIdx.value = flatIdx;
    dragOffsetY.value = 0;
    _dragDidMove = false;

    if ((e as PointerEvent).pointerId != null) {
      try { (e.currentTarget as Element).setPointerCapture((e as PointerEvent).pointerId); } catch { /* ignore */ }
    }

    document.addEventListener("pointermove", _onDragMove);
    document.addEventListener("pointerup", _onDragEnd);
    document.addEventListener("pointercancel", _onDragEnd);
    document.addEventListener("touchmove", _onTouchMove, { passive: false });
    document.addEventListener("touchend", _onDragEnd);
    document.addEventListener("touchcancel", _onDragEnd);
  }

  function _onDragMove(e: PointerEvent) {
    if (dragIdx.value < 0) return;
    _applyMove(e.clientY);
  }

  function _onTouchMove(e: TouchEvent) {
    if (dragIdx.value < 0) return;
    if (e.cancelable) e.preventDefault();
    _applyMove(e.touches[0].clientY);
  }

  function _applyMove(clientY: number) {
    const dy = clientY - _dragStartY;
    dragOffsetY.value = dy;

    const steps = Math.trunc(dy / _dragRowHeight);
    if (steps === 0) return;

    const arr = dragFlatList.value;
    if (!arr) return;
    const direction = steps > 0 ? 1 : -1;

    let target = dragIdx.value + direction;
    while (target >= 0 && target < arr.length && arr[target]?.type !== "ws") {
      target += direction;
    }

    // 上方向で ws が無ければ、ヘッダーより前（ungrouped エリア）への移動を許可
    if (direction === -1 && target < 0) {
      const hasHeaderAbove = arr.slice(0, dragIdx.value).some((item) => item.type === "header");
      if (!hasHeaderAbove) return;
      target = 0;
    } else if (target < 0 || target >= arr.length || arr[target]?.type !== "ws") {
      return;
    }

    const [moved] = arr.splice(dragIdx.value, 1);
    arr.splice(target, 0, moved);
    dragIdx.value = target;
    _dragStartY = clientY;
    dragOffsetY.value = 0;
    _dragDidMove = true;
  }

  async function _onDragEnd() {
    const moved = _dragDidMove;
    const finalList = dragFlatList.value ? [...dragFlatList.value] : null;
    _cleanupDragListeners();
    if (moved && finalList) {
      // dragFlatList は保存処理（onReorder）完了後にクリア（先にクリアすると旧順序が一瞬見える）
      await onReorder(finalList);
    }
    dragFlatList.value = null;
  }

  function _cleanupDragListeners() {
    document.removeEventListener("pointermove", _onDragMove);
    document.removeEventListener("pointerup", _onDragEnd);
    document.removeEventListener("pointercancel", _onDragEnd);
    document.removeEventListener("touchmove", _onTouchMove);
    document.removeEventListener("touchend", _onDragEnd);
    document.removeEventListener("touchcancel", _onDragEnd);
    dragIdx.value = -1;
    dragOffsetY.value = 0;
    _dragDidMove = false;
  }

  function cleanup() {
    _cleanupDragListeners();
    dragFlatList.value = null;
  }

  return { dragIdx, dragOffsetY, dragFlatList, onDragStart, cleanup };
}
