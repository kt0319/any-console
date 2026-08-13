import { ref } from "vue";
import type { Ref, ComputedRef } from "vue";

// buildFlatList（ui/utils/workspace-groups.ts）が返すフラットリストの1行。
// ヘッダー行（type:'header'）とワークスペース行（type:'ws'）を type で見分ける。
type FlatRow = { type: string } & Record<string, any>;

/**
 * グループヘッダーを含むフラットリスト（buildFlatList の結果）の
 * ワークスペース行ドラッグ並べ替え。ヘッダー行（type:'header'）を
 * 飛び越えて ws 行（type:'ws'）同士を入れ替える。
 *
 * @param opts.flatList ドラッグ対象のフラットリスト
 * @param opts.listEl リストのコンテナ要素
 * @param opts.onReorder 並べ替え確定時のコールバック（保存処理）
 * @param opts.rowSelector ワークスペース行のCSSセレクタ
 */
export function useWorkspaceListDrag({ flatList, listEl, onReorder, rowSelector = ".picker-ws-group" }: {
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

  // e は pointerdown / touchstart の両方から呼ばれるため PointerEvent | TouchEvent 相当
  function onDragStart(e, flatIdx: number) {
    const fl = flatList.value;
    if (fl.filter((item) => item.type === "ws").length < 2) return;
    const list = listEl.value;
    if (!list) return;

    if (navigator.vibrate) navigator.vibrate(30);

    dragFlatList.value = fl.map((item) => ({ ...item }));
    const rows = list.querySelectorAll(rowSelector);
    _dragRowHeight = rows[0]?.getBoundingClientRect().height || 44;
    _dragStartY = e.clientY ?? e.touches?.[0]?.clientY;
    dragIdx.value = flatIdx;
    dragOffsetY.value = 0;
    _dragDidMove = false;

    if (e.pointerId != null) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
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

    // ヘッダーを飛び越えて次のws項目を探す
    let target = dragIdx.value + direction;
    while (target >= 0 && target < arr.length && arr[target]?.type !== "ws") {
      target += direction;
    }

    // 上方向で ws が見つからない場合、ヘッダーより前（ungrouped エリア）への移動を許可
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
