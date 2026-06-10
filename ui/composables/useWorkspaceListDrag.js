import { ref } from "vue";

/**
 * グループヘッダーを含むフラットリスト（buildFlatList の結果）の
 * ワークスペース行ドラッグ並べ替え。ヘッダー行（type:'header'）を
 * 飛び越えて ws 行（type:'ws'）同士を入れ替える。
 *
 * @param {object} opts
 * @param {import("vue").ComputedRef<object[]>} opts.flatList - ドラッグ対象のフラットリスト
 * @param {import("vue").Ref<HTMLElement|null>} opts.listEl - リストのコンテナ要素
 * @param {(finalList: object[]) => Promise<void>|void} opts.onReorder - 並べ替え確定時のコールバック（保存処理）
 * @param {string} [opts.rowSelector] - ワークスペース行のCSSセレクタ
 */
export function useWorkspaceListDrag({ flatList, listEl, onReorder, rowSelector = ".picker-ws-group" }) {
  const dragIdx = ref(-1);
  const dragOffsetY = ref(0);
  const dragFlatList = ref(/** @type {any[]|null} */ (null));

  let _dragStartY = 0;
  let _dragRowHeight = 0;
  let _dragDidMove = false;

  function onDragStart(e, flatIdx) {
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
    const dy = clientY - _dragStartY;
    dragOffsetY.value = dy;

    const steps = Math.trunc(dy / _dragRowHeight);
    if (steps === 0) return;

    const arr = dragFlatList.value;
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
