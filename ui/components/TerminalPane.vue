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
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from "vue";
import { useTerminal } from "../composables/useTerminal.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useAuthStore } from "../stores/auth.js";
import { renderIconStr } from "../utils/render-icon.js";
import { enterViewMode, exitViewMode, isViewMode } from "../utils/view-mode.js";
import { emit } from "../app-bridge.js";
import { DRAG_THRESHOLD, LONG_PRESS_MS } from "../utils/constants.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";
import { useSplitDropDrag } from "../composables/useSplitDropDrag.js";
import { useLongPress } from "../composables/useLongPress.js";
import { isPastDragThreshold } from "../utils/gesture.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const auth = useAuthStore();
const { beginDrag, updateHover, finishSplitDrop, cancelDrag } = useSplitDropDrag();
const pillMouseLongPress = useLongPress(LONG_PRESS_MS);
const pillTouchLongPress = useLongPress(LONG_PRESS_MS);
const { ensureTerminalOpened, fitTerminal, observeFrameResize, connectTerminalWs } = useTerminal();

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
    if (retry === 0) {
      clearActiveFitTimer();
      activeFitTimer = setTimeout(() => {
        activeFitTimer = null;
        if (isActive.value) fitTerminal(props.tab, { force: true });
      }, 300);
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

async function doEnterViewMode() {
  const frame = frameEl.value;
  if (!frame || isViewMode(frame)) return;
  await enterViewMode(props.tab, frame, auth.apiFetch.bind(auth));
  const pre = frame.querySelector(".view-mode-textarea");
  if (pre) {
    let startX = 0;
    let startY = 0;
    pre.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      startY = e.clientY;
    });
    pre.addEventListener("click", (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      exitViewMode(frame);
      emit("keyboard:deactivate");
    });
  }
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
  const endY = e.changedTouches?.[0]?.clientY || 0;
  const deltaY = endY - touchStartY;
  if (frameEl.value && isViewMode(frameEl.value)) return;
  if (deltaY > 80 && frameEl.value) {
    doEnterViewMode();
    return;
  }
  if (Math.abs(deltaY) > 10) return;
  if (layoutStore.isSplitMode) {
    if (!isActive.value) {
      emits("select-pane", props.paneIndex);
    }
    return;
  }
  if (layoutStore.isPanelBottom && !(frameEl.value && isViewMode(frameEl.value))) {
    emit("keyboard:activate");
  }
}

let wheelAccum = 0;
let wheelTimer = null;
const WHEEL_THRESHOLD = -120;

function onWheel(e) {
  if (layoutStore.isTouchDevice) return;
  if (frameEl.value && isViewMode(frameEl.value)) return;
  if (e.deltaY >= 0) {
    wheelAccum = 0;
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  wheelAccum += e.deltaY;
  if (wheelTimer) clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { wheelAccum = 0; }, 300);
  if (wheelAccum <= WHEEL_THRESHOLD) {
    wheelAccum = 0;
    doEnterViewMode();
  }
}

// Mobile: Touch drag + long press for pill
let pillTouchStartX = 0;
let pillTouchStartY = 0;
let pillTouchDragging = false;
let pillLongPressed = false;

let pillMouseDownTime = 0;
let pillDidDrag = false;
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
  pillMouseLongPress.start(() => {
    if (frameEl.value && !isViewMode(frameEl.value)) {
      doEnterViewMode();
    }
  });
}

function onPillClick(e) {
  if (pillTouchLongPress.consumeFired() || pillMouseLongPress.consumeFired()) {
    if (e?.preventDefault) e.preventDefault();
    return;
  }
  if (frameEl.value && isViewMode(frameEl.value)) {
    if (e?.preventDefault) e.preventDefault();
    exitViewMode(frameEl.value);
    emit("keyboard:deactivate");
    return;
  }
  if (pillDidDrag) {
    pillDidDrag = false;
    return;
  }
  pillMouseLongPress.cancel();
  if (Date.now() - pillMouseDownTime > 300) return;
  emit("workspace:openModal");
}

function onPillMouseMove(e) {
  const dx = e.clientX - pillMouseStartX;
  const dy = e.clientY - pillMouseStartY;
  if (isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
    pillMouseLongPress.cancel();
  }
  if (!canDrag.value) return;
  if (!pillMouseDragging && isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
    pillMouseDragging = true;
    pillDidDrag = true;
    pillDragging.value = true;
    beginDrag(props.tab.id);
    e.preventDefault();
  }
  if (pillMouseDragging) {
    e.preventDefault();
    updateHover(e.clientX, e.clientY);
  }
}

function onPillMouseUp(e) {
  removePillMouseListeners();
  pillMouseLongPress.cancel();
  if (!pillMouseDragging) return;
  e.preventDefault();
  pillDragging.value = false;
  finishSplitDrop({
    tabId: props.tab.id,
    clientX: e.clientX,
    clientY: e.clientY,
    openTabs: terminalStore.openTabs,
    activeTabId: terminalStore.activeTabId,
  });
  setTimeout(() => { pillMouseDragging = false; }, 100);
}

function onPillTouchStart(e) {
  pillTouchDragging = false;
  pillLongPressed = false;
  pillTouchStartX = e.touches[0].clientX;
  pillTouchStartY = e.touches[0].clientY;
  pillTouchLongPress.reset();
  pillTouchLongPress.start(async () => {
    pillLongPressed = true;
    const frame = frameEl.value;
    if (!frame) return;
    if (isViewMode(frame)) {
      exitViewMode(frame);
      emit("keyboard:deactivate");
      return;
    }
    await doEnterViewMode();
  });
}

function onPillTouchMove(e) {
  const dx = e.touches[0].clientX - pillTouchStartX;
  const dy = e.touches[0].clientY - pillTouchStartY;
  if (isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
    pillTouchLongPress.cancel();
  }
  if (!canDrag.value) return;
  if (!pillTouchDragging && isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
    pillTouchDragging = true;
    pillDragging.value = true;
    beginDrag(props.tab.id);
    if (e.cancelable) e.preventDefault();
  }
  if (pillTouchDragging) {
    if (e.cancelable) e.preventDefault();
    updateHover(e.touches[0].clientX, e.touches[0].clientY);
  }
}

function onPillTouchEnd(e) {
  pillTouchLongPress.cancel();
  if (pillLongPressed) {
    pillLongPressed = false;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!pillTouchDragging) return;
  if (e.cancelable) e.preventDefault();
  pillDidDrag = true;
  pillDragging.value = false;
  const touch = e.changedTouches[0];
  finishSplitDrop({
    tabId: props.tab.id,
    clientX: touch.clientX,
    clientY: touch.clientY,
    openTabs: terminalStore.openTabs,
    activeTabId: terminalStore.activeTabId,
  });
  setTimeout(() => { pillTouchDragging = false; }, 100);
}

async function onPaste(e) {
  if (!isActive.value) return;
  const files = e.clipboardData?.files;
  if (!files || files.length === 0) return;
  const imageFile = Array.from(files).find((f) => f.type.startsWith("image/"));
  if (!imageFile) return;
  e.preventDefault();
  await uploadImageToTerminal({
    file: imageFile,
    apiFetch: auth.apiFetch.bind(auth),
    ws: props.tab.ws,
    notify: (message, type) => emit("toast:show", { message, type }),
  });
}

onMounted(() => {
  if (frameEl.value) {
    const fs = terminalStore.terminalSettings?.fontSize || 12;
    frameEl.value.style.setProperty("--terminal-font-size", `${fs}px`);
  }
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
  if (frameEl.value) {
    frameEl.value.addEventListener("wheel", onWheel, { passive: false, capture: true });
  }
  document.addEventListener("paste", onPaste, true);
});

watch(isActive, async (active) => {
  if (!active) return;
  if (props.tab._pendingRedraw && !props.tab.ws && !props.tab._wsDisposed) {
    connectTerminalWs(props.tab);
  }
  await nextTick();
  requestAnimationFrame(() => {
    scheduleActiveFit(0);
  });
});

onBeforeUnmount(() => {
  removePillMouseListeners();
  clearActiveFitTimer();
  cancelDrag();
  if (pillEl.value) {
    pillEl.value.removeEventListener("touchmove", onPillTouchMove);
    pillEl.value.removeEventListener("touchend", onPillTouchEnd);
  }
  if (frameEl.value) {
    frameEl.value.removeEventListener("wheel", onWheel);
  }
  document.removeEventListener("paste", onPaste, true);
});

defineExpose({
  tabId: props.tab.id,
  fit(opts) { fitTerminal(props.tab, opts); },
  getFrameEl() { return frameEl.value; },
});
</script>

<style scoped>
.terminal-pane {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.terminal-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  user-select: none;
  -webkit-user-select: none;
  border: 1px solid transparent;
  box-sizing: border-box;
}

.terminal-frame.view-mode {
  border-color: #ff9800;
  user-select: text;
  -webkit-user-select: text;
}

.terminal-frame.view-mode .tab-name-pill {
  border-color: #ff9800;
}

.terminal-frame.view-mode :deep(.xterm textarea) {
  display: none !important;
}

.terminal-frame :deep(.xterm) {
  width: 100%;
  height: 100%;
}

.terminal-frame :deep(.xterm-viewport) {
  scrollbar-width: none;
}

.terminal-frame :deep(.xterm-viewport::-webkit-scrollbar) {
  display: none;
}

.tab-name-pill {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  max-width: min(80vw, 420px);
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.93);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.2;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: pointer;
  gap: 6px;
}

.tab-name-pill img {
  pointer-events: none;
  -webkit-user-drag: none;
}

.tab-name-pill.dragging {
  opacity: 0.5;
}

.tab-name-pill-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tab-name-pill :deep(.favicon-icon) {
  width: 14px;
  height: 14px;
}

.tab-name-pill:active {
  transform: scale(0.93);
  transition: transform 0.1s ease, background 0.1s ease;
}

.tab-name-pill.tab-activity {
  animation: pill-activity-glow 3s ease-in-out 1;
}

@keyframes pill-activity-glow {
  0%, 100% { border-color: var(--border); }
  50% { border-color: rgba(130, 170, 255, 0.7); }
}

:deep(.view-mode-textarea) {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9;
  width: 100%;
  height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  overflow-x: hidden;
  overflow-y: auto;
  background: #1a1b26;
  color: #e0e4fc;
  font-family: "Hack Nerd Font", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace;
  font-size: var(--terminal-font-size, 12px);
  line-height: 1.25;
  letter-spacing: 0.5px;
  box-sizing: border-box;
  outline: none;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
  -webkit-user-select: text;
}

@media (pointer: coarse) {
  .terminal-frame :deep(.xterm textarea) {
    pointer-events: none !important;
  }
}

@media (min-width: 769px) {
  .tab-name-pill {
    cursor: grab;
    top: 20px;
    right: 20px;
  }

  .tab-name-pill.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }
}
</style>
