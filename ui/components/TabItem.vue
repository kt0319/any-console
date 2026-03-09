<template>
  <button
    ref="pillEl"
    class="tab-btn"
    :class="{ active: isActive, 'tab-activity': tab._activity, orphan: isOrphan, dragging: isDragging, 'drag-over-left': dropSide === 'left', 'drag-over-right': dropSide === 'right' }"
    :draggable="canDrag"
    tabindex="-1"
    @mousedown="onMouseDown"
    @click="onClick"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover="onDragOverTab"
    @dragleave="onDragLeaveTab"
    @drop="onDropOnTab"
    @touchstart.passive="onTouchStart"
  >
    <span v-if="wsIconHtml" v-html="wsIconHtml"></span>
    <span v-if="iconHtml" v-html="iconHtml"></span>
    <template v-if="!isPanelBottom">
      {{ label }}
      <span
        class="tab-close"
        @mousedown.stop.prevent="onClosePress"
        @touchstart.stop.prevent="onClosePress"
        @click.stop="onClose"
      >&times;</span>
    </template>
  </button>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { renderIconStr } from "../utils/render-icon.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { emit } from "../app-bridge.js";
import { DRAG_THRESHOLD, LONG_PRESS_MS } from "../utils/constants.js";
import { useSplitDropDrag } from "../composables/useSplitDropDrag.js";
import { useLongPress } from "../composables/useLongPress.js";
import { isPastDragThreshold } from "../utils/gesture.js";

const props = defineProps({
  tab: { type: Object, required: true },
  activeTabId: { type: String, default: null },
  isPanelBottom: { type: Boolean, default: false },
  isOrphan: { type: Boolean, default: false },
});

const emits = defineEmits(["select", "close", "active-click"]);
const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const { beginDrag, updateHover, finishSplitDrop, cancelDrag } = useSplitDropDrag();
const mouseLongPress = useLongPress(LONG_PRESS_MS);
const touchLongPress = useLongPress(LONG_PRESS_MS);
const pillEl = ref(null);
const isDragging = ref(false);
const dropSide = ref("");

const isActive = computed(() => props.activeTabId === props.tab.id);
const canDrag = computed(() => terminalStore.openTabs.length >= 1);

const label = computed(() => {
  return props.tab.workspace || props.tab.label || "terminal";
});

const wsIconHtml = computed(() => {
  if (props.tab.wsIcon) return renderIconStr(props.tab.wsIcon.name, props.tab.wsIcon.color, 14);
  return "";
});

const iconHtml = computed(() => {
  if (props.tab.icon) return renderIconStr(props.tab.icon.name, props.tab.icon.color, 14);
  return "";
});

function onClick(e) {
  mouseLongPress.cancel();
  if (isDragging.value) return;
  e.currentTarget?.blur();
  if (isActive.value) {
    emits("active-click", props.tab);
    return;
  }
  emits("select", props.tab);
}

function onClose() {
  emits("close", props.tab);
}

function onClosePress() {
  mouseLongPress.cancel();
  touchLongPress.cancel();
}

function onMouseDown() {
  mouseLongPress.start(() => {
    emit("settings:open", { view: "TabConfig" });
  });
}

// PC: HTML5 Drag & Drop
function onDragStart(e) {
  mouseLongPress.cancel();
  if (!canDrag.value) { e.preventDefault(); return; }
  e.dataTransfer.setData("text/plain", props.tab.id);
  e.dataTransfer.effectAllowed = "move";
  isDragging.value = true;
  beginDrag(props.tab.id);
}

function onDragEnd(e) {
  isDragging.value = false;
  dropSide.value = "";
  cancelDrag();
  e.currentTarget?.blur();
}

function resolveDragTabId(e) {
  const raw = layoutStore.dragTabId || e?.dataTransfer?.getData("text/plain");
  const value = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function onDragOverTab(e) {
  if (!canDrag.value) return;
  const dragTabId = resolveDragTabId(e);
  if (!dragTabId || dragTabId === props.tab.id) {
    dropSide.value = "";
    return;
  }
  const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === dragTabId);
  const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === props.tab.id);
  if (fromIndex < 0 || targetIndex < 0) {
    dropSide.value = "";
    return;
  }
  e.preventDefault();
  const rect = e.currentTarget.getBoundingClientRect();
  const isLeft = e.clientX < rect.left + rect.width / 2;
  dropSide.value = isLeft ? "left" : "right";
}

function onDragLeaveTab(e) {
  if (e.currentTarget?.contains(e.relatedTarget)) return;
  dropSide.value = "";
}

function onDropOnTab(e) {
  dropSide.value = "";
  if (!canDrag.value) return;
  e.preventDefault();
  const dragTabId = resolveDragTabId(e);
  if (!dragTabId || dragTabId === props.tab.id) return;

  const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === dragTabId);
  const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === props.tab.id);
  if (fromIndex < 0 || targetIndex < 0) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const insertBefore = e.clientX < rect.left + rect.width / 2;
  let toIndex = insertBefore ? targetIndex : targetIndex + 1;
  if (fromIndex < toIndex) toIndex -= 1;
  toIndex = Math.max(0, Math.min(toIndex, terminalStore.openTabs.length - 1));
  terminalStore.moveTab(fromIndex, toIndex);

  cancelDrag();
}

// Mobile: Touch drag + long press
let touchStartX = 0;
let touchStartY = 0;
let touchDragging = false;

function onTouchStart(e) {
  touchDragging = false;
  touchLongPress.reset();
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchLongPress.start(() => {
    emit("settings:open", { view: "TabConfig" });
  });
}

function onTouchMove(e) {
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
    touchLongPress.cancel();
  }
  if (!canDrag.value) return;

  if (!touchDragging && isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
    touchDragging = true;
    isDragging.value = true;
    beginDrag(props.tab.id);
    if (e.cancelable) e.preventDefault();
  }

  if (touchDragging) {
    if (e.cancelable) e.preventDefault();
    updateHover(e.touches[0].clientX, e.touches[0].clientY);
  }
}

function onTouchEnd(e) {
  touchLongPress.cancel();
  if (touchLongPress.consumeFired()) return;
  if (!touchDragging) return;
  if (e.cancelable) e.preventDefault();
  isDragging.value = false;
  const touch = e.changedTouches[0];
  finishSplitDrop({
    tabId: props.tab.id,
    clientX: touch.clientX,
    clientY: touch.clientY,
    openTabs: terminalStore.openTabs,
    activeTabId: terminalStore.activeTabId,
  });
  setTimeout(() => { touchDragging = false; }, 100);
}

onMounted(() => {
  const el = pillEl.value;
  if (!el) return;
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd, { passive: false });
});

onBeforeUnmount(() => {
  const el = pillEl.value;
  if (!el) return;
  el.removeEventListener("touchmove", onTouchMove);
  el.removeEventListener("touchend", onTouchEnd);
});
</script>
