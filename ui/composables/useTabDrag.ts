import { ref, computed, onMounted, onBeforeUnmount, type Ref } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useSplitDropDrag } from "./useSplitDropDrag.ts";
import { resolveDropIndex } from "../utils/tab-nav.ts";
import { DRAG_THRESHOLD } from "../utils/constants.ts";
import { isPastDragThreshold, createTouchTracker } from "../utils/gesture.ts";

/**
 * タブ1つ分のドラッグ操作（TabItem.vue から抽出）。PC: HTML5 D&D によるタブ並び替え +
 * 分割ドロップ。モバイル: 縦移動のみスプリットドラッグとして扱う（横移動は
 * touch-action:pan-x のネイティブスクロールに委ねるため、タッチでの並び替えは行わない）。
 */
export function useTabDrag(options: {
  tabId: () => number,
  pillEl: Ref<HTMLElement | null>,
  /** クローズボタン押下中はドラッグを開始しない（TabItem の closePending）。 */
  isClosePending: () => boolean,
}) {
  const { tabId, pillEl, isClosePending } = options;
  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();
  const { beginDrag, updateHover, finishSplitDrop, cancelDrag } = useSplitDropDrag();

  const isDragging = ref(false);
  const dropSide = ref("");
  let lastInputWasTouch = false;

  const canDrag = computed(() => !layoutStore.isTouchDevice && terminalStore.openTabs.length >= 1);
  // タッチでのドラッグ（縦方向のスプリットドロップ）は全タブで有効。
  const canTouchDrag = computed(() => terminalStore.openTabs.length >= 1);
  const effectiveDropSide = computed(() => {
    if (layoutStore.dragOverTabId === tabId()) return layoutStore.dragOverSide;
    return dropSide.value;
  });

  /** 直近の入力がタッチだったかを返し、フラグをリセットする（select 時の focus 抑止用）。 */
  function consumeLastInputWasTouch() {
    const value = lastInputWasTouch;
    lastInputWasTouch = false;
    return value;
  }

  // PC: HTML5 Drag & Drop
  function onDragStart(e: DragEvent) {
    if (!canDrag.value || isClosePending()) { e.preventDefault(); return; }
    e.dataTransfer!.setData("text/plain", String(tabId()));
    e.dataTransfer!.effectAllowed = "move";
    isDragging.value = true;
    beginDrag(tabId());
  }

  function onDragEnd(e: DragEvent) {
    isDragging.value = false;
    dropSide.value = "";
    cancelDrag();
    (e.currentTarget as HTMLElement)?.blur();
  }

  function resolveDragTabId(e: DragEvent) {
    const raw = layoutStore.dragTabId || e?.dataTransfer?.getData("text/plain");
    const value = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function onDragOverTab(e: DragEvent) {
    if (!canDrag.value) return;
    const dragTabId = resolveDragTabId(e);
    if (!dragTabId || dragTabId === tabId()) {
      dropSide.value = "";
      return;
    }
    const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === dragTabId);
    const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === tabId());
    if (fromIndex < 0 || targetIndex < 0) {
      dropSide.value = "";
      return;
    }
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isLeft = e.clientX < rect.left + rect.width / 2;
    dropSide.value = isLeft ? "left" : "right";
  }

  function onDragLeaveTab(e: DragEvent) {
    if ((e.currentTarget as HTMLElement)?.contains(e.relatedTarget as Node | null)) return;
    dropSide.value = "";
  }

  function onDropOnTab(e: DragEvent) {
    dropSide.value = "";
    if (!canDrag.value) return;
    e.preventDefault();
    const dragTabId = resolveDragTabId(e);
    if (!dragTabId || dragTabId === tabId()) return;

    const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === dragTabId);
    const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === tabId());
    if (fromIndex < 0 || targetIndex < 0) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertBefore = e.clientX < rect.left + rect.width / 2;
    terminalStore.moveTab(
      fromIndex,
      resolveDropIndex(fromIndex, targetIndex, insertBefore, terminalStore.openTabs.length),
    );

    cancelDrag();
  }

  const touchTracker = createTouchTracker();

  function clearDragOverIndicator() {
    layoutStore.dragOverTabId = null;
    layoutStore.dragOverSide = "";
  }

  function onTouchStart(e: TouchEvent) {
    lastInputWasTouch = true;
    touchTracker.start(e);
    isDragging.value = false;
  }

  function onTouchMove(e: TouchEvent) {
    if (!canTouchDrag.value) return;
    if (!isDragging.value) {
      const { dx, dy } = touchTracker.delta(e);
      if (!isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) return;
      // 横方向はネイティブスクロール（touch-action:pan-x）に委ねる。
      // preventDefaultせずここで何もしない。
      if (Math.abs(dx) >= Math.abs(dy)) return;
      isDragging.value = true;
      beginDrag(tabId());
    }
    if (e.cancelable) e.preventDefault();
    const touch = e.touches[0];
    updateHover(touch.clientX, touch.clientY);
  }

  function onTouchEnd(e: TouchEvent) {
    if (isDragging.value) {
      if (e.cancelable) e.preventDefault();
      const touch = e.changedTouches[0];
      finishSplitDrop({ tabId: tabId(), clientX: touch.clientX, clientY: touch.clientY });
      clearDragOverIndicator();
      cancelDrag();
      isDragging.value = false;
    }
    // 長押し→そのまま離す＝クローズは廃止。クローズは tab-close ボタン経由のみ。
  }

  function onTouchCancel() {
    if (isDragging.value) {
      isDragging.value = false;
      clearDragOverIndicator();
      cancelDrag();
    }
  }

  onMounted(() => {
    const el = pillEl.value;
    if (!el) return;
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel);
  });

  onBeforeUnmount(() => {
    const el = pillEl.value;
    if (!el) return;
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchCancel);
  });

  return {
    canDrag,
    isDragging,
    effectiveDropSide,
    onDragStart,
    onDragEnd,
    onDragOverTab,
    onDragLeaveTab,
    onDropOnTab,
    onTouchStart,
    consumeLastInputWasTouch,
  };
}
