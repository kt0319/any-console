<template>
  <div
    class="terminal-pane"
    :class="{ active: isActive }"
    ref="paneEl"
    @pointerdown.capture="onPointerDown"
    @touchstart="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
  >
    <StatusOverlay :visible="isReconnecting" :label="reconnectLabel" variant="warning" />
    <RadialKey :state="radial.state" :keys="radialKeys" :specials="radialSpecials" />
    <div :id="'frame-' + tab.id" class="terminal-frame" ref="frameEl">
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
        <span v-if="isDirty" class="pill-dirty-dot" aria-label="uncommitted changes"></span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick, toRef } from "vue";
import { useTerminal } from "../composables/useTerminal.js";
import { useTerminalStore, setTouchEnv } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import { ACTIVE_FIT_DELAY_MS } from "../utils/constants.js";
import { usePillDrag } from "../composables/usePillDrag.js";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useTerminalPaste } from "../composables/useTerminalPaste.js";
import { useTerminalPaneGestures } from "../composables/useTerminalPaneGestures.js";
import { useRadialKey } from "../composables/useRadialKey.js";
import RadialKey from "./RadialKey.vue";
import StatusOverlay from "./StatusOverlay.vue";
import { buildReconnectLabel } from "../utils/terminal-ws.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
setTouchEnv(layoutStore.isTouchDevice);
const workspaceStore = useWorkspaceStore();

const isDirty = computed(() => {
  if (!props.tab.workspace) return false;
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace);
  return ws?.clean === false;
});
const { ensureTerminalOpened, fitTerminal, sendResize, observeFrameResize, connectTerminalWs } = useTerminal();

const paneEl = ref(null);
const frameEl = ref(null);
const pillEl = ref(null);
let activeFitTimer = null;

const canDrag = computed(() => terminalStore.openTabs.length >= 1);

const tabId = computed(() => props.tab.id);
const { pillDragging, onPillMouseDown, onPillClick, onPillTouchStart, onPillTouchMove, onPillTouchEnd } = usePillDrag({
  tabId,
  canDrag,
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

const { isOffline } = useConnectivityMonitor();
const isReconnecting = computed(() =>
  !isOffline.value && !!terminalStore.tabFlags[props.tab.id]?.reconnecting,
);
const reconnectLabel = computed(() =>
  buildReconnectLabel(terminalStore.tabFlags[props.tab.id]?.reconnectReason),
);

const tabRef = toRef(props, "tab");
const paneIndexRef = toRef(props, "paneIndex");
const radial = useRadialKey();
const radialKeys = radial.keys;
const radialSpecials = radial.specials;
const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = useTerminalPaneGestures({
  tab: tabRef,
  pillEl,
  radial,
  isActive,
  paneIndex: paneIndexRef,
  onSelectPane: (idx) => emits("select-pane", idx),
});
useTerminalPaste({ tab: tabRef, isActive });

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
    fitTerminal(props.tab);
    if (props.tab.term) {
      try { props.tab.term.refresh(0, props.tab.term.rows - 1); } catch {}
    }
  }, ACTIVE_FIT_DELAY_MS);
}

function onPointerDown(e) {
  if (layoutStore.isTouchDevice) return;
  const tab = props.tab;
  if (tab) {
    fitTerminal(tab);
    if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
      try { sendResize(tab); } catch {}
    }
    if (tab.term) {
      try { tab.term.refresh(0, tab.term.rows - 1); } catch {}
    }
  }
  if (!layoutStore.isSplitMode) return;
  if (isActive.value) return;
  emits("select-pane", props.paneIndex);
}

function onWheel(e) {
  const term = props.tab?.term;
  if (!term) return;
  e.preventDefault();
}

// term.open() 後に xterm フォーカスポリシーを注入する。
// isPanelBottom（モバイル / 狭幅PC）では textarea へのフォーカスを禁止し、
// キーボードバー入力経由でのみターミナルへ送るよう統一する。
function applyFocusGuard(term) {
  if (!term?.textarea) return;
  const origFocus = term.focus.bind(term);
  term.focus = () => { if (!layoutStore.isPanelBottom) origFocus(); };
  term.textarea.tabIndex = -1;
  term.textarea.addEventListener("focus", () => {
    if (layoutStore.isPanelBottom) term.textarea.blur();
  });
}

onMounted(() => {
  if (frameEl.value) {
    const fs = terminalStore.terminalSettings?.fontSize || 12;
    frameEl.value.style.setProperty("--terminal-font-size", `${fs}px`);
  }
  if (props.tab._pendingOpen && frameEl.value) {
    // 非アクティブな復元タブは hidden 状態で term.open() を呼ぶと
    // xterm.js のセル寸法計測が 0 になり fit が永久に失敗するため、
    // isActive になるまで open を遅延させる
    if (!isActive.value && props.tab._pendingRedraw) {
      // isActive watcher で開く
    } else {
      ensureTerminalOpened(props.tab, frameEl.value);
      applyFocusGuard(props.tab.term);
      requestAnimationFrame(() => fitTerminal(props.tab));
    }
  } else if (props.tab.term && frameEl.value && props.tab.term.element) {
    frameEl.value.appendChild(props.tab.term.element);
    applyFocusGuard(props.tab.term);
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
});

watch(isActive, async (active) => {
  if (!active) return;
  // 非アクティブ復元タブで遅延していた term.open() をここで実行（表示状態で正しく寸法計測される）
  if (props.tab._pendingOpen && frameEl.value) {
    ensureTerminalOpened(props.tab, frameEl.value);
    applyFocusGuard(props.tab.term);
  }
  if (props.tab._pendingRedraw && !props.tab.ws && !props.tab._wsDisposed) {
    connectTerminalWs(props.tab, {
      onOpen: () => scheduleActiveFit(),
    });
    return;
  }
  await nextTick();
  scheduleActiveFit();
  try { props.tab.term?.focus(); } catch {}
});

onBeforeUnmount(() => {
  clearActiveFitTimer();
  if (pillEl.value) {
    pillEl.value.removeEventListener("touchmove", onPillTouchMove);
    pillEl.value.removeEventListener("touchend", onPillTouchEnd);
  }
  if (frameEl.value) {
    frameEl.value.removeEventListener("wheel", onWheel, { capture: true });
  }
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

.pill-dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5a623;
  flex-shrink: 0;
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
