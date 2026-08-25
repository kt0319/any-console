import { ref, computed, onMounted, onBeforeUnmount, type ComputedRef, type Ref } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useSplitDropDrag } from "./useSplitDropDrag.ts";
import { resolveDropIndex } from "../utils/tab-nav.ts";
import { DRAG_THRESHOLD } from "../utils/constants.ts";
import { isPastDragThreshold, createTouchTracker } from "../utils/gesture.ts";

/**
 * タブ1つ分のドラッグ操作（TabItem.vue から抽出）。
 * - PC: HTML5 Drag & Drop によるタブ並び替え + 分割ドロップ
 * - モバイル: 長押し無しで閾値を超えた瞬間にドラッグ開始し、その時点の移動方向で
 *   分岐する。横移動はアクティブタブの並び替え専用（非アクティブタブの横移動は
 *   preventDefault せず touch-action:pan-x のネイティブスクロールに委ねる）、
 *   縦移動はアクティブ/非アクティブ問わずスプリットドラッグになる。
 * クローズはタブ本体のタップ/クリックでは行わず、常に tab-close ボタン経由。
 */
export function useTabDrag(options: {
  tabId: () => number,
  isActive: ComputedRef<boolean>,
  pillEl: Ref<HTMLElement | null>,
  /** クローズボタン押下中はドラッグを開始しない（TabItem の closePending）。 */
  isClosePending: () => boolean,
}) {
  const { tabId, isActive, pillEl, isClosePending } = options;
  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();
  const { beginDrag, updateHover, finishSplitDrop, cancelDrag } = useSplitDropDrag();

  const isDragging = ref(false);
  const dropSide = ref("");
  let lastInputWasTouch = false;

  const canDrag = computed(() => !layoutStore.isTouchDevice && terminalStore.openTabs.length >= 1);
  // タッチでのドラッグ処理そのものは全タブで有効にする（分岐は onTouchMove 側）。
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

  // Mobile: タッチドラッグ
  const touchTracker = createTouchTracker();
  // 閾値超え時点の移動方向で確定する軸。"horizontal" = 並び替え（アクティブ
  // タブのみ）、"vertical" = 分割ドラッグ（全タブ）。
  const touchDragAxis = ref<"horizontal" | "vertical" | null>(null);

  function hitTestTab(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY);
    const btn = el?.closest?.<HTMLElement>(".tab-btn[data-tab-id]");
    if (!btn) return null;
    const hitTabId = Number(btn.dataset.tabId);
    if (!Number.isFinite(hitTabId) || hitTabId === tabId()) return null;
    const rect = btn.getBoundingClientRect();
    const side = clientX < rect.left + rect.width / 2 ? "left" : "right";
    return { tabId: hitTabId, side };
  }

  function clearDragOverIndicator() {
    layoutStore.dragOverTabId = null;
    layoutStore.dragOverSide = "";
  }

  function finishTouchDrag(clientX: number, clientY: number) {
    if (touchDragAxis.value === "vertical") {
      finishSplitDrop({ tabId: tabId(), clientX, clientY });
      clearDragOverIndicator();
      cancelDrag();
      return;
    }
    const hit = hitTestTab(clientX, clientY);
    if (hit) {
      const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === tabId());
      const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === hit.tabId);
      if (fromIndex >= 0 && targetIndex >= 0) {
        terminalStore.moveTab(
          fromIndex,
          resolveDropIndex(fromIndex, targetIndex, hit.side === "left", terminalStore.openTabs.length),
        );
      }
    } else {
      finishSplitDrop({ tabId: tabId(), clientX, clientY });
    }
    clearDragOverIndicator();
    cancelDrag();
  }

  function onTouchStart(e: TouchEvent) {
    lastInputWasTouch = true;
    touchTracker.start(e);
    isDragging.value = false;
    touchDragAxis.value = null;
  }

  function onTouchMove(e: TouchEvent) {
    if (!canTouchDrag.value) return;
    if (!isDragging.value) {
      const { dx, dy } = touchTracker.delta(e);
      if (!isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) return;
      const axis = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
      // 横方向はアクティブタブの並び替え専用。非アクティブタブの横移動は
      // ここで何もせず、touch-action:pan-x によるネイティブのタブバー
      // スクロールに委ねる（preventDefaultしない）。
      if (axis === "horizontal" && !isActive.value) return;
      touchDragAxis.value = axis;
      isDragging.value = true;
      beginDrag(tabId());
    }
    if (e.cancelable) e.preventDefault();
    const touch = e.touches[0];
    updateHover(touch.clientX, touch.clientY);
    if (touchDragAxis.value === "vertical") return;
    const hit = hitTestTab(touch.clientX, touch.clientY);
    layoutStore.dragOverTabId = hit?.tabId ?? null;
    layoutStore.dragOverSide = hit?.side ?? "";
  }

  function onTouchEnd(e: TouchEvent) {
    if (isDragging.value) {
      if (e.cancelable) e.preventDefault();
      const touch = e.changedTouches[0];
      finishTouchDrag(touch.clientX, touch.clientY);
      isDragging.value = false;
    }
    touchDragAxis.value = null;
    // 長押し→そのまま離す＝クローズは廃止。クローズは tab-close ボタン経由のみ。
  }

  function onTouchCancel() {
    if (isDragging.value) {
      isDragging.value = false;
      clearDragOverIndicator();
      cancelDrag();
    }
    touchDragAxis.value = null;
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
