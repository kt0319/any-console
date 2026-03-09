<template>
  <button
    ref="pillEl"
    class="tab-btn"
    :class="{ active: isActive, 'tab-activity': tab._activity, orphan: isOrphan, dragging: isDragging }"
    :draggable="canDrag && !isTouchDevice"
    @click="onClick"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @touchstart.passive="onTouchStart"
  >
    <span v-if="wsIconHtml" v-html="wsIconHtml"></span>
    <span v-if="iconHtml" v-html="iconHtml"></span>
    <template v-if="!panelBottom">
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

const DRAG_THRESHOLD = 15;

const props = defineProps({
  tab: { type: Object, required: true },
  activeTabId: { type: String, default: null },
  panelBottom: { type: Boolean, default: false },
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
  if (props.isOrphan) return props.tab.workspace || "terminal";
  return props.tab.workspace || props.tab.label || "";
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

// PC: HTML5 Drag & Drop
function onDragStart(e) {
  if (!canDrag.value) { e.preventDefault(); return; }
  e.dataTransfer.setData("text/plain", props.tab.id);
  e.dataTransfer.effectAllowed = "move";
  isDragging.value = true;
  layoutStore.dragTabId = props.tab.id;
  layoutStore.showDropZones = true;
}

function onDragEnd() {
  isDragging.value = false;
  layoutStore.showDropZones = false;
  layoutStore.dragTabId = null;
}

// Mobile: Touch drag
let touchStartX = 0;
let touchStartY = 0;
let touchDragging = false;

function onTouchStart(e) {
  touchDragging = false;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}

function onTouchMove(e) {
  if (!canDrag.value) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;

  if (!touchDragging && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
    touchDragging = true;
    isDragging.value = true;
    layoutStore.dragTabId = props.tab.id;
    layoutStore.showDropZones = true;
    e.preventDefault();
  }

  if (touchDragging) {
    e.preventDefault();
    updateTouchDropZoneHover(e.touches[0]);
  }
}

function onTouchEnd(e) {
  if (!touchDragging) return;
  e.preventDefault();
  isDragging.value = false;

  const touch = e.changedTouches[0];
  const dropDir = detectDropZone(touch);

  layoutStore.showDropZones = false;

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
