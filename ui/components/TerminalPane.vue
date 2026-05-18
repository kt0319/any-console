<template>
  <div
    class="terminal-pane"
    :class="{ active: isActive }"
    ref="paneEl"
    @pointerdown.capture="onPointerDown"
    @touchstart="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
  >
    <div :id="'frame-' + tab.id" class="terminal-frame" ref="frameEl">
      <div v-if="isReconnecting" class="terminal-reconnecting" aria-live="polite">
        <span class="terminal-reconnecting-label">Reconnecting</span>
        <span class="terminal-reconnecting-dots" aria-hidden="true"></span>
      </div>
      <div
        class="terminal-info-pill"
        :class="{ 'tab-activity': tab._activity, dragging: pillDragging }"
        ref="pillEl"
        tabindex="-1"
        @mousedown="onPillMouseDown"
        @click="onPillClick"
        @touchstart.passive="onPillTouchStart"
      >
        <span class="terminal-info-pill-info">
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
import { useTerminalStore, isLinkTapped, setLongPressActive, setTouchEnv } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { renderIconStr } from "../utils/render-icon.js";
import { enterViewMode, exitViewMode, isViewMode } from "../utils/view-mode.js";
import { emit } from "../app-bridge.js";
import { WHEEL_DEBOUNCE_MS, ACTIVE_FIT_DELAY_MS, WHEEL_FOCUS_THRESHOLD } from "../utils/constants.js";
import { uploadImageToTerminal } from "../utils/upload-image-to-terminal.js";
import { openExternalUrl } from "../utils/open-external.js";
import { useConfirm } from "../composables/useConfirm.js";
import { usePillDrag } from "../composables/usePillDrag.js";
import { createTouchTracker } from "../utils/gesture.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const { confirm } = useConfirm();
setTouchEnv(layoutStore.isTouchDevice);
const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const { ensureTerminalOpened, fitTerminal, sendResize, observeFrameResize, connectTerminalWs } = useTerminal();

const paneEl = ref(null);
const frameEl = ref(null);
const pillEl = ref(null);
const paneTouch = createTouchTracker();
let activeFitTimer = null;

const canDrag = computed(() => terminalStore.openTabs.length >= 1);

const tabId = computed(() => props.tab.id);
const { pillDragging, onPillMouseDown, onPillClick, onPillTouchStart, onPillTouchMove, onPillTouchEnd } = usePillDrag({
  tabId,
  canDrag,
  frameEl,
  isViewMode,
  doEnterViewMode,
  exitViewMode: (frame) => { exitViewMode(frame); },
  onTabClick: () => {
    if (props.tab.workspace) {
      workspaceStore.selectedWorkspace = props.tab.workspace;
      emit("git:openFileModal");
    } else {
      emit("workspace:openModal");
    }
  },
  emit,
});

const isActive = computed(() => {
  if (layoutStore.isSplitMode && props.paneIndex >= 0) {
    return layoutStore.activePaneIndex === props.paneIndex;
  }
  return terminalStore.activeTabId === props.tab.id;
});

const isReconnecting = computed(() => !!terminalStore.tabFlags[props.tab.id]?.reconnecting);

function clearActiveFitTimer() {
  if (activeFitTimer) {
    clearTimeout(activeFitTimer);
    activeFitTimer = null;
  }
}

function scheduleActiveFit() {
  if (!isActive.value) return;
  clearActiveFitTimer();
  activeFitTimer = setTimeout(() => {
    activeFitTimer = null;
    if (!isActive.value) return;
    fitTerminal(props.tab, { force: true });
    if (props.tab.term) {
      try { props.tab.term.refresh(0, props.tab.term.rows - 1); } catch {}
    }
  }, ACTIVE_FIT_DELAY_MS);
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
  const tab = props.tab;
  if (tab) {
    tab._lastFitCols = 0;
    tab._lastFitRows = 0;
    fitTerminal(tab, { force: true });
    if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
      try { sendResize(tab); } catch {}
    }
    try { tab.term?.refresh(0, tab.term.rows - 1); } catch {}
    tab.term?.scrollToBottom?.();
  }
  if (!layoutStore.isSplitMode) return;
  if (isActive.value) return;
  emits("select-pane", props.paneIndex);
}


let touchStartTime = 0;
let touchMoved = false;
let lastTouchPos = { x: 0, y: 0 };
let longPressTimer = null;
let pendingUrl = null;
const LONG_PRESS_URL_MS = 400;
const URL_REGEX = /(https?:\/\/[^\s)\]>'"]+|www\.[^\s)\]>'"]+)/g;

function cancelLongPressTimer() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function findUrlAtPosition(clientX, clientY) {
  const term = props.tab?.term;
  if (!term || !term.element) return null;
  const screen = term.element.querySelector(".xterm-screen") || term.element;
  const rect = screen.getBoundingClientRect();
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;
  if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) return null;
  const cols = term.cols;
  const rows = term.rows;
  if (!cols || !rows) return null;
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  const col = Math.floor(relX / cellW);
  const rowOffset = Math.floor(relY / cellH);
  const buf = term.buffer.active;
  const lineIdx = buf.viewportY + rowOffset;
  if (!buf.getLine(lineIdx)) return null;

  function lastCharOf(line) {
    if (!line) return " ";
    return line.getCell(line.length - 1)?.getChars() || " ";
  }

  let startIdx = lineIdx;
  while (startIdx > 0) {
    const prev = buf.getLine(startIdx - 1);
    if (!prev) break;
    const last = lastCharOf(prev);
    if (last === "" || last === " ") break;
    startIdx--;
  }

  let endIdx = lineIdx;
  while (endIdx < buf.length - 1) {
    const cur = buf.getLine(endIdx);
    if (!cur) break;
    const last = lastCharOf(cur);
    if (last === "" || last === " ") break;
    endIdx++;
  }

  let text = "";
  const lineOffsets = {};
  for (let i = startIdx; i <= endIdx; i++) {
    const cur = buf.getLine(i);
    if (!cur) break;
    lineOffsets[i] = text.length;
    for (let j = 0; j < cur.length; j++) {
      text += cur.getCell(j)?.getChars() || "";
    }
  }

  const absPos = (lineOffsets[lineIdx] || 0) + col;
  URL_REGEX.lastIndex = 0;
  let m;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (absPos >= m.index && absPos < m.index + m[0].length) {
      let url = m[0];
      if (url.startsWith("www.")) url = "https://" + url;
      return url;
    }
  }
  return null;
}

function onTouchStart(e) {
  paneTouch.start(e);
  setLongPressActive(false);
  const t = e.touches?.[0];
  lastTouchPos = { x: t?.clientX || 0, y: t?.clientY || 0 };
  touchStartTime = Date.now();
  touchMoved = false;
  pendingUrl = null;
  cancelLongPressTimer();
  longPressTimer = setTimeout(async () => {
    longPressTimer = null;
    if (touchMoved) return;
    const url = findUrlAtPosition(lastTouchPos.x, lastTouchPos.y);
    if (!url) return;
    pendingUrl = url;
    if (navigator.vibrate) navigator.vibrate(40);
    if (await confirm(`Open URL?\n\n${url}`)) {
      openExternalUrl(url);
    }
    pendingUrl = null;
  }, LONG_PRESS_URL_MS);
}

function onTouchMove(e) {
  const { dx, dy } = paneTouch.delta(e);
  if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
    touchMoved = true;
    pendingUrl = null;
    cancelLongPressTimer();
  }
}

function onTouchEnd(e) {
  cancelLongPressTimer();
  if (pendingUrl) {
    return;
  }
  if (isLinkTapped()) return;
  if (pillEl.value && pillEl.value.contains(e.target)) return;
  const { dx: deltaX, dy: deltaY } = paneTouch.delta(e);
  if (frameEl.value && isViewMode(frameEl.value)) return;
  if (deltaY > 80 && frameEl.value) {
    doEnterViewMode();
    return;
  }
  if (Math.abs(deltaX) > 20 || Math.abs(deltaY) > 20) return;
  if (layoutStore.isSplitMode) {
    if (!isActive.value) {
      emits("select-pane", props.paneIndex);
    }
    return;
  }
  if (layoutStore.isPanelBottom && !(frameEl.value && isViewMode(frameEl.value))) {
    emit("keyboard:activate");
    props.tab?.term?.scrollToBottom?.();
  }
}

let wheelAccum = 0;
let wheelTimer = null;

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
  wheelTimer = setTimeout(() => { wheelAccum = 0; }, WHEEL_DEBOUNCE_MS);
  if (wheelAccum <= WHEEL_FOCUS_THRESHOLD) {
    wheelAccum = 0;
    doEnterViewMode();
  }
}


async function onPaste(e) {
  if (!isActive.value) return;
  const files = e.clipboardData?.files;
  if (!files || files.length === 0) return;
  const imageFile = Array.from(files).find((f) => f.type.startsWith("image/"));
  if (!imageFile) return;
  e.preventDefault();
  emit("keyboard:deactivate");
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
    connectTerminalWs(props.tab, {
      onOpen: () => scheduleActiveFit(),
    });
    return;
  }
  await nextTick();
  scheduleActiveFit();
});

onBeforeUnmount(() => {
  clearActiveFitTimer();
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
  fit(opts) {
    if (!paneEl.value || paneEl.value.offsetParent === null) return;
    fitTerminal(props.tab, opts);
  },
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
  -webkit-touch-callout: none;
  border: 1px solid transparent;
  box-sizing: border-box;
}

.terminal-frame.view-mode {
  border-color: var(--warning);
  user-select: text;
  -webkit-user-select: text;
}

.terminal-frame.view-mode .terminal-info-pill {
  border-color: var(--warning);
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

.terminal-reconnecting {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 25;
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  padding: 10px 18px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warning, #eea644) 75%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning, #eea644) 75%, transparent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
}

.terminal-reconnecting-dots {
  display: inline-block;
  width: 1.2em;
  text-align: left;
  white-space: pre;
}

.terminal-reconnecting-dots::after {
  content: "";
  animation: terminal-reconnecting-dots 1.2s steps(4) infinite;
}

@keyframes terminal-reconnecting-dots {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
}

.terminal-info-pill {
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

.terminal-info-pill img {
  pointer-events: none;
  -webkit-user-drag: none;
}

.terminal-info-pill.dragging {
  opacity: 0.5;
}

.terminal-info-pill-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.terminal-info-pill :deep(.favicon-icon) {
  width: 14px;
  height: 14px;
}

.terminal-info-pill:active {
  transform: scale(0.93);
  transition: transform 0.1s ease, background 0.1s ease;
}

.terminal-info-pill.tab-activity {
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
  touch-action: auto;
}

@media (pointer: coarse) {
  .terminal-frame :deep(.xterm textarea) {
    pointer-events: none !important;
  }
}

@media (min-width: 769px) {
  .terminal-info-pill {
    cursor: grab;
    top: 20px;
    right: 20px;
  }

  .terminal-info-pill.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }
}

</style>
