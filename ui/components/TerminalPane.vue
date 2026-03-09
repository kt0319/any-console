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
import { exitViewMode, isViewMode } from "../utils/view-mode.js";
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
const { ensureTerminalOpened, fitTerminal, observeFrameResize } = useTerminal();

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
    emit("settings:open", { view: "TabConfig" });
  });
}

function onPillClick() {
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
  pillTouchLongPress.start(() => {
    pillLongPressed = true;
    emit("settings:open", { view: "TabConfig" });
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
  cancelDrag();
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
