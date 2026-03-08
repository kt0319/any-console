<template>
  <div
    class="terminal-pane"
    :class="{ active: isActive }"
    ref="paneEl"
    @pointerdown="onPointerDown"
    @touchstart="onTouchStart"
    @touchend="onTouchEnd"
  >
    <div :id="'frame-' + tab.id" class="terminal-frame" ref="frameEl">
      <div
        class="tab-name-pill"
        :class="{ 'tab-activity': tab._activity, dragging: pillDragging }"
        ref="pillEl"
        :draggable="canDrag && !layoutStore.isTouchDevice"
        @dragstart="onPillDragStart"
        @dragend="onPillDragEnd"
        @touchstart.passive="onPillTouchStart"
      >
        <span class="tab-name-pill-info">
          <span v-if="tab.wsIcon" v-html="renderIcon(tab.wsIcon.name, tab.wsIcon.color, 14)"></span>
          <span v-if="tab.icon" v-html="renderIcon(tab.icon.name, tab.icon.color, 14)"></span>
          {{ tab.label || '' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, computed } from "vue";
import { useTerminal } from "../composables/useTerminal.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { renderIconStr } from "../utils/render-icon.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const { ensureTerminalOpened, fitTerminal, disconnectTerminal } = useTerminal();

const DRAG_THRESHOLD = 15;

const paneEl = ref(null);
const frameEl = ref(null);
const pillEl = ref(null);
const pillDragging = ref(false);
let touchStartY = 0;

const canDrag = computed(() => terminalStore.openTabs.length >= 2);

function renderIcon(icon, color, size) {
  return renderIconStr(icon, color, size);
}

const isActive = computed(() => {
  if (layoutStore.splitMode && props.paneIndex >= 0) {
    return layoutStore.activePaneIndex === props.paneIndex;
  }
  return terminalStore.activeTabId === props.tab.id;
});

function onPointerDown(e) {
  if (layoutStore.isTouchDevice) return;
  if (!layoutStore.splitMode) return;
  if (isActive.value) return;
  emits("select-pane", props.paneIndex);
}

function onTouchStart(e) {
  touchStartY = e.touches?.[0]?.clientY || 0;
}

function onTouchEnd(e) {
  const endY = e.changedTouches?.[0]?.clientY || 0;
  if (Math.abs(endY - touchStartY) > 10) return;
  if (!layoutStore.splitMode) return;
  emits("select-pane", props.paneIndex);
}

// PC: HTML5 Drag & Drop for pill
function onPillDragStart(e) {
  if (!canDrag.value) { e.preventDefault(); return; }
  e.dataTransfer.setData("text/plain", String(props.tab.id));
  e.dataTransfer.effectAllowed = "move";
  pillDragging.value = true;
  layoutStore.dragTabId = props.tab.id;
  layoutStore.showDropZones = true;
}

function onPillDragEnd() {
  pillDragging.value = false;
  layoutStore.showDropZones = false;
  layoutStore.dragTabId = null;
}

// Mobile: Touch drag for pill
let pillTouchStartX = 0;
let pillTouchStartY = 0;
let pillTouchDragging = false;

function onPillTouchStart(e) {
  pillTouchDragging = false;
  pillTouchStartX = e.touches[0].clientX;
  pillTouchStartY = e.touches[0].clientY;
}

function onPillTouchMove(e) {
  if (!canDrag.value) return;
  const dx = e.touches[0].clientX - pillTouchStartX;
  const dy = e.touches[0].clientY - pillTouchStartY;
  if (!pillTouchDragging && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
    pillTouchDragging = true;
    pillDragging.value = true;
    layoutStore.dragTabId = props.tab.id;
    layoutStore.showDropZones = true;
    e.preventDefault();
  }
  if (pillTouchDragging) {
    e.preventDefault();
    const overlay = document.querySelector(".split-drop-overlay");
    if (overlay) {
      overlay.querySelectorAll(".split-drop-zone").forEach((z) => {
        const r = z.getBoundingClientRect();
        z.classList.toggle("drag-over",
          e.touches[0].clientX >= r.left && e.touches[0].clientX <= r.right &&
          e.touches[0].clientY >= r.top && e.touches[0].clientY <= r.bottom);
      });
    }
  }
}

function onPillTouchEnd(e) {
  if (!pillTouchDragging) return;
  e.preventDefault();
  pillDragging.value = false;
  const touch = e.changedTouches[0];
  const overlay = document.querySelector(".split-drop-overlay");
  let dropDir = null;
  if (overlay) {
    for (const z of overlay.querySelectorAll(".split-drop-zone")) {
      const r = z.getBoundingClientRect();
      if (touch.clientX >= r.left && touch.clientX <= r.right &&
          touch.clientY >= r.top && touch.clientY <= r.bottom) {
        const match = z.className.match(/\bdrop-(left|right|top|bottom|center)\b/);
        dropDir = match ? match[1] : null;
        break;
      }
    }
  }
  layoutStore.showDropZones = false;
  if (dropDir) {
    layoutStore.splitWithDrop(props.tab.id, dropDir, terminalStore.openTabs, terminalStore.activeTabId);
  }
  layoutStore.dragTabId = null;
  setTimeout(() => { pillTouchDragging = false; }, 100);
}

onMounted(() => {
  if (props.tab._pendingOpen && frameEl.value) {
    ensureTerminalOpened(props.tab, frameEl.value);
  }
  if (pillEl.value) {
    pillEl.value.addEventListener("touchmove", onPillTouchMove, { passive: false });
    pillEl.value.addEventListener("touchend", onPillTouchEnd, { passive: false });
  }
});

onBeforeUnmount(() => {
  if (pillEl.value) {
    pillEl.value.removeEventListener("touchmove", onPillTouchMove);
    pillEl.value.removeEventListener("touchend", onPillTouchEnd);
  }
});

defineExpose({
  fit() { fitTerminal(props.tab); },
  getFrameEl() { return frameEl.value; },
});
</script>
