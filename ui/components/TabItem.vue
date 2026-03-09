<template>
  <button
    ref="pillEl"
    class="tab-btn"
    :class="{ active: isActive, 'tab-activity': tab._activity, orphan: isOrphan, dragging: isDragging }"
    :draggable="canDrag"
    tabindex="-1"
    @mousedown="onMouseDown"
    @click="onClick"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @touchstart.passive="onTouchStart"
  >
    <span v-if="wsIconHtml" v-html="wsIconHtml"></span>
    <span v-if="iconHtml" v-html="iconHtml"></span>
    <template v-if="!isPanelBottom">
      {{ label }}
      <span class="tab-close" @click.stop="onClose">&times;</span>
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

const props = defineProps({
  tab: { type: Object, required: true },
  activeTabId: { type: String, default: null },
  isPanelBottom: { type: Boolean, default: false },
  isOrphan: { type: Boolean, default: false },
});

const emits = defineEmits(["select", "close", "active-click"]);
const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const pillEl = ref(null);
const isDragging = ref(false);

const isTouchDevice = layoutStore.isTouchDevice;
const isActive = computed(() => props.activeTabId === props.tab.id);
const canDrag = computed(() => terminalStore.openTabs.length >= 2);

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

function onClick() {
  clearLongPress();
  if (isDragging.value) return;
  if (isActive.value) {
    emits("active-click", props.tab);
    return;
  }
  emits("select", props.tab);
}

function onClose() {
  emits("close", props.tab);
}

// PC: long press
let longPressTimer = null;

function clearLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function onMouseDown() {
  clearLongPress();
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    emit("settings:open", { view: "TabConfig" });
  }, LONG_PRESS_MS);
}

// PC: HTML5 Drag & Drop
function onDragStart(e) {
  clearLongPress();
  if (!canDrag.value) { e.preventDefault(); return; }
  e.dataTransfer.setData("text/plain", props.tab.id);
  e.dataTransfer.effectAllowed = "move";
  isDragging.value = true;
  layoutStore.dragTabId = props.tab.id;
  layoutStore.isShowDropZones = true;
}

function onDragEnd() {
  isDragging.value = false;
  layoutStore.isShowDropZones = false;
  layoutStore.dragTabId = null;
}

// Mobile: Touch drag + long press
let touchStartX = 0;
let touchStartY = 0;
let touchDragging = false;
let touchLongPressTimer = null;
let touchLongPressed = false;

function clearTouchLongPress() {
  if (touchLongPressTimer) {
    clearTimeout(touchLongPressTimer);
    touchLongPressTimer = null;
  }
}

function onTouchStart(e) {
  touchDragging = false;
  touchLongPressed = false;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  clearTouchLongPress();
  touchLongPressTimer = setTimeout(() => {
    touchLongPressed = true;
    emit("settings:open", { view: "TabConfig" });
  }, LONG_PRESS_MS);
}

function onTouchMove(e) {
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
    clearTouchLongPress();
  }
  if (!canDrag.value) return;

  if (!touchDragging && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
    touchDragging = true;
    isDragging.value = true;
    layoutStore.dragTabId = props.tab.id;
    layoutStore.isShowDropZones = true;
    e.preventDefault();
  }

  if (touchDragging) {
    e.preventDefault();
    updateTouchDropZoneHover(e.touches[0]);
  }
}

function onTouchEnd(e) {
  clearTouchLongPress();
  if (touchLongPressed) { touchLongPressed = false; return; }
  if (!touchDragging) return;
  e.preventDefault();
  isDragging.value = false;

  const touch = e.changedTouches[0];
  const dropDir = detectDropZone(touch);

  layoutStore.isShowDropZones = false;

  if (dropDir) {
    layoutStore.splitWithDrop(
      props.tab.id,
      dropDir,
      terminalStore.openTabs,
      terminalStore.activeTabId,
    );
  }

  layoutStore.dragTabId = null;
  setTimeout(() => { touchDragging = false; }, 100);
}

function updateTouchDropZoneHover(touch) {
  const overlay = document.querySelector(".split-drop-overlay");
  if (!overlay) return;
  overlay.querySelectorAll(".split-drop-zone").forEach((z) => {
    const r = z.getBoundingClientRect();
    z.classList.toggle("drag-over",
      touch.clientX >= r.left && touch.clientX <= r.right &&
      touch.clientY >= r.top && touch.clientY <= r.bottom);
  });
}

function detectDropZone(touch) {
  const overlay = document.querySelector(".split-drop-overlay");
  if (!overlay) return null;
  for (const z of overlay.querySelectorAll(".split-drop-zone")) {
    const r = z.getBoundingClientRect();
    if (touch.clientX >= r.left && touch.clientX <= r.right &&
        touch.clientY >= r.top && touch.clientY <= r.bottom) {
      const match = z.className.match(/\bdrop-(left|right|top|bottom|center)\b/);
      return match ? match[1] : null;
    }
  }
  return null;
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
