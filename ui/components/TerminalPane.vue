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
        @mousedown="onPillMouseDown"
        @click="onPillClick"
        @touchstart.passive="onPillTouchStart"
      >
        <span class="tab-name-pill-info">
          <span v-if="tab.wsIcon" v-html="renderIconStr(tab.wsIcon.name, tab.wsIcon.color, 14)"></span>
          <span v-if="tab.icon" v-html="renderIconStr(tab.icon.name, tab.icon.color, 14)"></span>
          {{ tab.workspace || tab.label || '' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount, watch, computed, nextTick } from "vue";
import { useTerminal } from "../composables/useTerminal.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useAuthStore } from "../stores/auth.js";
import { renderIconStr } from "../utils/render-icon.js";
import { enterViewMode, exitViewMode, isViewMode } from "../utils/view-mode.js";
import { emit } from "../app-bridge.js";
import { DRAG_THRESHOLD, LONG_PRESS_MS } from "../utils/constants.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const auth = useAuthStore();
const { ensureTerminalOpened, fitTerminal, observeFrameResize, disconnectTerminal } = useTerminal();

const paneEl = ref(null);
const frameEl = ref(null);
const pillEl = ref(null);
const pillDragging = ref(false);
let touchStartY = 0;
let activeFitTimer = null;

const canDrag = computed(() => terminalStore.openTabs.length >= 1);

const isActive = computed(() => {
  if (layoutStore.isSplitMode && props.paneIndex >= 0) {
    return layoutStore.activePaneIndex === props.paneIndex;
  }
  return terminalStore.activeTabId === props.tab.id;
});

function clearActiveFitTimer() {
  if (activeFitTimer) {
    clearTimeout(activeFitTimer);
    activeFitTimer = null;
  }
}

function scheduleActiveFit(retry = 0) {
  if (!isActive.value) return;
  const frame = frameEl.value;
  if (!frame) return;
  const rect = frame.getBoundingClientRect();
  if (rect.width >= 2 && rect.height >= 2) {
    fitTerminal(props.tab, { force: true });
    if (props.tab.term) {
      try {
        props.tab.term.refresh(0, props.tab.term.rows - 1);
      } catch {}
    }
    return;
  }
  if (retry >= 8) return;
  clearActiveFitTimer();
  activeFitTimer = setTimeout(() => {
    activeFitTimer = null;
    scheduleActiveFit(retry + 1);
  }, 60);
}

function onPointerDown(e) {
  if (layoutStore.isTouchDevice) return;
  if (!layoutStore.isSplitMode) return;
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
  if (layoutStore.isPanelBottom) {
    emit("keyboard:activate");
  }
  if (layoutStore.isSplitMode) {
    emits("select-pane", props.paneIndex);
    return;
  }
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
let pillMouseLongPressTimer = null;
let pillMouseStartX = 0;
let pillMouseStartY = 0;
let pillMouseDragging = false;

function removePillMouseListeners() {
  document.removeEventListener("mousemove", onPillMouseMove);
  document.removeEventListener("mouseup", onPillMouseUp);
}

function onPillMouseDown(e) {
  if (e.button !== 0) return;
  pillMouseDownTime = Date.now();
  pillDidDrag = false;
  pillMouseDragging = false;
  pillMouseStartX = e.clientX;
  pillMouseStartY = e.clientY;
  removePillMouseListeners();
  document.addEventListener("mousemove", onPillMouseMove);
  document.addEventListener("mouseup", onPillMouseUp);
  if (pillMouseLongPressTimer) clearTimeout(pillMouseLongPressTimer);
  pillMouseLongPressTimer = setTimeout(() => {
    pillMouseLongPressTimer = null;
    emit("settings:open", { view: "TabConfig" });
  }, LONG_PRESS_MS);
}

function onPillClick() {
  if (pillDidDrag) {
    pillDidDrag = false;
    return;
  }
  if (pillMouseLongPressTimer) {
    clearTimeout(pillMouseLongPressTimer);
    pillMouseLongPressTimer = null;
  }
  if (Date.now() - pillMouseDownTime > 300) return;
  emit("workspace:openModal");
}

function onPillMouseMove(e) {
  const dx = e.clientX - pillMouseStartX;
  const dy = e.clientY - pillMouseStartY;
  if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
    if (pillMouseLongPressTimer) {
      clearTimeout(pillMouseLongPressTimer);
      pillMouseLongPressTimer = null;
    }
  }
  if (!canDrag.value) return;
  if (!pillMouseDragging && dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
    pillMouseDragging = true;
    pillDidDrag = true;
    pillDragging.value = true;
    layoutStore.dragTabId = props.tab.id;
    layoutStore.isShowDropZones = true;
    e.preventDefault();
  }
  if (pillMouseDragging) {
    e.preventDefault();
    updateDropZoneHover(e.clientX, e.clientY);
  }
}

function onPillMouseUp(e) {
  removePillMouseListeners();
  if (pillMouseLongPressTimer) {
    clearTimeout(pillMouseLongPressTimer);
    pillMouseLongPressTimer = null;
  }
  if (!pillMouseDragging) return;
  e.preventDefault();
  pillDragging.value = false;
  const dropDir = detectDropZone(e.clientX, e.clientY);
  layoutStore.isShowDropZones = false;
  if (dropDir) {
    layoutStore.splitWithDrop(props.tab.id, dropDir, terminalStore.openTabs, terminalStore.activeTabId);
  }
  layoutStore.dragTabId = null;
  setTimeout(() => { pillMouseDragging = false; }, 100);
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
    emit("settings:open", { view: "TabConfig" });
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
    layoutStore.isShowDropZones = true;
    if (e.cancelable) e.preventDefault();
  }
  if (pillTouchDragging) {
    if (e.cancelable) e.preventDefault();
    updateDropZoneHover(e.touches[0].clientX, e.touches[0].clientY);
  }
}

function onPillTouchEnd(e) {
  clearPillLongPress();
  if (pillLongPressed) {
    pillLongPressed = false;
    return;
  }
  if (!pillTouchDragging) return;
  if (e.cancelable) e.preventDefault();
  pillDidDrag = true;
  pillDragging.value = false;
  const touch = e.changedTouches[0];
  const dropDir = detectDropZone(touch.clientX, touch.clientY);
  layoutStore.isShowDropZones = false;
  if (dropDir) {
    layoutStore.splitWithDrop(props.tab.id, dropDir, terminalStore.openTabs, terminalStore.activeTabId);
  }
  layoutStore.dragTabId = null;
  setTimeout(() => { pillTouchDragging = false; }, 100);
}

function updateDropZoneHover(clientX, clientY) {
  const overlay = document.querySelector(".split-drop-overlay");
  if (!overlay) return;
  overlay.querySelectorAll(".split-drop-zone").forEach((z) => {
    const r = z.getBoundingClientRect();
    z.classList.toggle("drag-over", clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom);
  });
}

function detectDropZone(clientX, clientY) {
  const overlay = document.querySelector(".split-drop-overlay");
  if (!overlay) return null;
  for (const z of overlay.querySelectorAll(".split-drop-zone")) {
    const r = z.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const match = z.className.match(/\bdrop-(top-left|top-right|bottom-left|bottom-right|left|right|top|bottom|center)\b/);
      return match ? match[1] : null;
    }
  }
  return null;
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
    requestAnimationFrame(() => fitTerminal(props.tab));
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

watch(isActive, async (active) => {
  if (!active) return;
  await nextTick();
  requestAnimationFrame(() => {
    scheduleActiveFit(0);
  });
});

onBeforeUnmount(() => {
  removePillMouseListeners();
  clearActiveFitTimer();
  if (pillEl.value) {
    pillEl.value.removeEventListener("touchmove", onPillTouchMove);
    pillEl.value.removeEventListener("touchend", onPillTouchEnd);
  }
  document.removeEventListener("paste", onPaste, true);
});

defineExpose({
  tabId: props.tab.id,
  fit(opts) { fitTerminal(props.tab, opts); },
  getFrameEl() { return frameEl.value; },
});
</script>
