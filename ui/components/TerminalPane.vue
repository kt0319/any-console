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
        tabindex="-1"
        :draggable="canDrag && !layoutStore.isTouchDevice"
        @mousedown="onPillMouseDown"
        @mouseup="onPillMouseUp"
        @dragstart="onPillDragStart"
        @dragend="onPillDragEnd"
        @touchstart.passive="onPillTouchStart"
      >
        <span class="tab-name-pill-info">
          <span v-if="tab.wsIcon" v-html="renderIcon(tab.wsIcon.name, tab.wsIcon.color, 14)"></span>
          <span v-if="tab.icon" v-html="renderIcon(tab.icon.name, tab.icon.color, 14)"></span>
          {{ tab.workspace || tab.label || '' }}
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
import { useAuthStore } from "../stores/auth.js";
import { renderIconStr } from "../utils/render-icon.js";
import { enterViewMode, exitViewMode, isViewMode } from "../utils/view-mode.js";
import { emit } from "../app-bridge.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const auth = useAuthStore();
const { ensureTerminalOpened, fitTerminal, observeFrameResize, disconnectTerminal } = useTerminal();

const DRAG_THRESHOLD = 15;
const LONG_PRESS_MS = 500;

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
  if (pillEl.value && pillEl.value.contains(e.target)) return;
  if (frameEl.value && isViewMode(frameEl.value)) {
    exitViewMode(frameEl.value);
    return;
  }
  const endY = e.changedTouches?.[0]?.clientY || 0;
  if (Math.abs(endY - touchStartY) > 10) return;
  if (layoutStore.splitMode) {
    emits("select-pane", props.paneIndex);
    return;
  }
  emit("keyboard:activate");
}

// PC: HTML5 Drag & Drop for pill
function onPillDragStart(e) {
  if (!canDrag.value) { e.preventDefault(); return; }
  e.dataTransfer.setData("text/plain", String(props.tab.id));
  e.dataTransfer.effectAllowed = "move";
  pillDragging.value = true;
  pillDidDrag = true;
  layoutStore.dragTabId = props.tab.id;
  layoutStore.showDropZones = true;
}

function onPillDragEnd() {
  pillDragging.value = false;
  layoutStore.showDropZones = false;
  layoutStore.dragTabId = null;
}

// Mobile: Touch drag + long press for pill
let pillTouchStartX = 0;
let pillTouchStartY = 0;
let pillTouchDragging = false;
let pillLongPressTimer = null;
let pillLongPressed = false;

function clearPillLongPress() {
  if (pillLongPressTimer) {
    clearTimeout(pillLongPressTimer);
    pillLongPressTimer = null;
  }
}

let pillMouseDownTime = 0;
let pillDidDrag = false;

function onPillMouseDown() {
  pillMouseDownTime = Date.now();
  pillDidDrag = false;
}

function onPillMouseUp() {
  if (pillDidDrag) return;
  if (Date.now() - pillMouseDownTime > 300) return;
  emit("workspace:openModal");
}

function toggleViewMode() {
  if (!frameEl.value) return;
  if (isViewMode(frameEl.value)) {
    exitViewMode(frameEl.value);
  } else {
    props.tab.term?.scrollToBottom();
    enterViewMode(props.tab, frameEl.value, auth.apiFetch.bind(auth));
  }
}

function onPillTouchStart(e) {
  pillTouchDragging = false;
  pillLongPressed = false;
  pillTouchStartX = e.touches[0].clientX;
  pillTouchStartY = e.touches[0].clientY;
  clearPillLongPress();
  pillLongPressTimer = setTimeout(() => {
    pillLongPressed = true;
    toggleViewMode();
  }, LONG_PRESS_MS);
}

function onPillTouchMove(e) {
  const dx = e.touches[0].clientX - pillTouchStartX;
  const dy = e.touches[0].clientY - pillTouchStartY;
  if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
    clearPillLongPress();
  }
  if (!canDrag.value) return;
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
  clearPillLongPress();
  if (pillLongPressed) {
    pillLongPressed = false;
    return;
  }
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

const encoder = new TextEncoder();

async function onPaste(e) {
  if (!isActive.value) return;
  const files = e.clipboardData?.files;
  if (!files || files.length === 0) return;
  const imageFile = Array.from(files).find((f) => f.type.startsWith("image/"));
  if (!imageFile) return;
  e.preventDefault();
  emit("toast:show", { message: "画像アップロード中...", type: "success" });
  try {
    const formData = new FormData();
    formData.append("file", imageFile);
    const res = await auth.apiFetch("/upload-image", { method: "POST", body: formData });
    if (!res || !res.ok) throw new Error("アップロード失敗");
    const data = await res.json();
    if (props.tab.ws && props.tab.ws.readyState === WebSocket.OPEN) {
      props.tab.ws.send(encoder.encode(data.path));
    }
    emit("toast:show", { message: "画像アップロード完了", type: "success" });
  } catch (err) {
    emit("toast:show", { message: `画像アップロード失敗: ${err.message}`, type: "error" });
  }
}

onMounted(() => {
  if (props.tab._pendingOpen && frameEl.value) {
    ensureTerminalOpened(props.tab, frameEl.value);
  } else if (props.tab.term && frameEl.value && props.tab.term.element) {
    frameEl.value.appendChild(props.tab.term.element);
    observeFrameResize(props.tab, frameEl.value);
    requestAnimationFrame(() => fitTerminal(props.tab));
  }
  if (pillEl.value) {
    pillEl.value.addEventListener("touchmove", onPillTouchMove, { passive: false });
    pillEl.value.addEventListener("touchend", onPillTouchEnd, { passive: false });
  }
  document.addEventListener("paste", onPaste, true);
});

onBeforeUnmount(() => {
  if (pillEl.value) {
    pillEl.value.removeEventListener("touchmove", onPillTouchMove);
    pillEl.value.removeEventListener("touchend", onPillTouchEnd);
  }
  document.removeEventListener("paste", onPaste, true);
});

defineExpose({
  fit() { fitTerminal(props.tab); },
  getFrameEl() { return frameEl.value; },
});
</script>
