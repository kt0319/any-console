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
    <CircleKeyPad :state="circleKeypad.state" :keys="circleKeypadKeys" :specials="circleKeypadSpecials" />
    <div :id="'frame-' + tab.id" class="terminal-frame" ref="frameEl">
      <div class="pill-group" ref="pillEl">
        <div
          class="terminal-info-pill"
          :class="{ 'tab-activity': tab._activity, 'pill-working': agentState === 'working', dragging: pillDragging }"
          :data-tooltip="pillTooltip"
          tabindex="-1"
          @mousedown="onPillMouseDown"
          @click="onPillClick"
          @touchstart.passive="onPillTouchStart"
        >
          <span class="terminal-info-pill-info">
            <span v-if="tab.wsIcon" class="pill-icon-badge-wrap">
              <span v-html="renderIconStr(tab.wsIcon.name, tab.wsIcon.color, 14)"></span>
              <span v-if="isDirty" class="pill-dirty-badge" aria-label="uncommitted changes"></span>
            </span>
            <span v-if="tab.icon" class="pill-icon-slot pill-icon-badge-wrap">
              <span v-html="renderIconStr(tab.icon.name, tab.icon.color, 14)"></span>
              <span v-if="!tab.wsIcon && isDirty" class="pill-dirty-badge" aria-label="uncommitted changes"></span>
            </span>
            {{ tab.workspace || tab.label || '' }}
            <span v-if="layoutStore.isSplitMode && (behind > 0 || ahead > 0)" class="pill-ahead-behind" aria-label="ahead/behind commits">
              <span v-if="behind > 0" class="pill-behind">&darr;{{ behind }}</span>
              <span v-if="ahead > 0" class="pill-ahead">&uarr;{{ ahead }}</span>
            </span>
          </span>
        </div>
        <button
          v-if="layoutStore.isSplitMode && isDirty"
          type="button"
          class="pill-numstat-btn"
          aria-label="Changes"
          data-tooltip="Changes"
          @pointerdown.stop
          @click.stop="openChanges"
        >
          <span v-if="changedFiles > 0" class="numstat-files">{{ changedFiles }}F</span>
          <span class="diff-num-plus">+{{ insertions }}</span>
          <span class="diff-num-del">-{{ deletions }}</span>
        </button>
        <button
          v-if="layoutStore.isSplitMode"
          type="button"
          class="pill-close-btn pill-minus-btn"
          aria-label="Remove from split"
          data-tooltip="Remove from split"
          @pointerdown.stop="onSplitCloseDown"
          @pointerup.stop="onSplitCloseUp"
          @click.stop
        >&minus;</button>
        <button
          v-if="!layoutStore.isSplitMode"
          type="button"
          class="pill-close-btn pill-tab-close-btn"
          aria-label="Close tab"
          data-tooltip="Close tab"
          @pointerdown.stop="onTabCloseDown"
          @pointerup.stop="onTabCloseUp"
          @click.stop
        >&times;</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick, toRef } from "vue";
import { useTerminal } from "../composables/useTerminal.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import { ACTIVE_FIT_DELAY_MS } from "../utils/constants.js";
import { usePillDrag } from "../composables/usePillDrag.js";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useTerminalPaste } from "../composables/useTerminalPaste.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import { useTerminalPaneGestures } from "../composables/useTerminalPaneGestures.js";
import { useCircleKeyPad } from "../composables/useCircleKeyPad.js";
import { useWorkspaceGitStatus } from "../composables/useWorkspaceGitStatus.js";
import CircleKeyPad from "./CircleKeyPad.vue";
import StatusOverlay from "./StatusOverlay.vue";
import { buildReconnectLabel } from "../utils/terminal-ws.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const { confirm } = useConfirm();

const paneWorkspace = computed(() =>
  props.tab.workspace ? workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace) : undefined,
);
// 分割モードでは WorkspaceStatusBar（アクティブタブ1つ分の表示）が隠れるため、
// ペインごとの git 情報（変更行数・ahead/behind）をピルに直接出す。
const { isDirty, ahead, behind, changedFiles, insertions, deletions } = useWorkspaceGitStatus(paneWorkspace, ref(false));

function openChanges() {
  if (!props.tab.workspace) return;
  workspaceStore.selectedWorkspace = props.tab.workspace;
  emit("git:openFileModal", { pane: "changes" });
}

const agentState = computed(() => terminalStore.agentStates[props.tab.sessionId] || "");
const { ensureTerminalOpened, fitTerminal, sendResize, observeFrameResize, connectTerminalWs } = useTerminal();

const paneEl = ref(null);
const frameEl = ref(null);
const pillEl = ref(null);
let activeFitTimer = null;

const canDrag = computed(() => terminalStore.openTabs.length >= 1);
const pillTooltip = computed(() =>
  layoutStore.isTouchDevice ? "Tap for details" : "Drag to split  ·  Click for details",
);

const tabId = computed(() => props.tab.id);
const { pillDragging, onPillMouseDown, onPillClick, onPillTouchStart, onPillTouchMove, onPillTouchEnd } = usePillDrag({
  tabId,
  canDrag,
  onTabClick: () => {
    if (props.tab.workspace) {
      workspaceStore.selectedWorkspace = props.tab.workspace;
      // ピルに ahead/behind（push/pullマーク）が出ている時は、その操作をする Branches ペインへ直接開く。
      const hasPushPullMark = layoutStore.isSplitMode && (ahead.value > 0 || behind.value > 0);
      emit("git:openFileModal", hasPushPullMark ? { pane: "branch" } : undefined);
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
const circleKeypad = useCircleKeyPad();
const circleKeypadKeys = circleKeypad.keys;
const circleKeypadSpecials = circleKeypad.specials;
const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = useTerminalPaneGestures({
  tab: tabRef,
  pillEl,
  circleKeypad,
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

function onSplitCloseDown(e) {
  e.currentTarget.setPointerCapture(e.pointerId);
}

function onSplitCloseUp() {
  layoutStore.replaceTabWithEmpty(props.tab.id);
}

let tabClosePending = false;

function onTabCloseDown(e) {
  e.currentTarget.setPointerCapture(e.pointerId);
  tabClosePending = true;
}

async function onTabCloseUp() {
  if (!tabClosePending) return;
  tabClosePending = false;
  const result = await confirmCloseTab(confirm, props.tab);
  if (result === true) emit("tab:close", { tab: props.tab });
  else if (result === "refresh") emit("tab:refresh", { tab: props.tab });
  else if (result === "detach") terminalStore.detachTab(props.tab.id);
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
      try { tab.term.focus(); } catch {}
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
    // isActive になるまで open を遅延させる。
    // ただし分割モードのペインは非アクティブでも画面上に表示されているので即時 open する。
    const inVisibleSplitPane = layoutStore.isSplitMode && props.paneIndex >= 0;
    if (!isActive.value && props.tab._pendingRedraw && !inVisibleSplitPane) {
      // isActive watcher で開く
    } else {
      ensureTerminalOpened(props.tab, frameEl.value);
      applyFocusGuard(props.tab.term);
      requestAnimationFrame(() => fitTerminal(props.tab));
      // 非アクティブな分割ペインは isActive watcher が発火しないため WS 接続を自分でトリガー
      if (inVisibleSplitPane && !isActive.value && props.tab._pendingRedraw
          && !props.tab.ws && !props.tab._wsDisposed) {
        connectTerminalWs(props.tab, { onOpen: () => requestAnimationFrame(() => fitTerminal(props.tab)) });
      }
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
  if (terminalStore.suppressNextFocus) {
    terminalStore.suppressNextFocus = false;
    return;
  }
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

.pill-group {
  position: absolute;
  top: 10px;
  right: 10px;
  /* Modal.vue の .modal-overlay(z-index:20) より下にして、設定ダイアログ表示中は
     このピルが上に乗って見えない・誤操作できてしまわないようにする。 */
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(80vw, 450px);
}

.terminal-info-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid rgba(59, 66, 97, 0.5);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  color: var(--text-secondary);
  opacity: 0.9;
  font-size: 12px;
  line-height: 1.2;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: pointer;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.terminal-info-pill img {
  pointer-events: none;
  -webkit-user-drag: none;
}

.pill-ahead-behind {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
}

.pill-behind {
  color: var(--warning);
}

.pill-ahead {
  color: var(--accent);
}

.pill-numstat-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 8px;
  flex-shrink: 0;
  border: 1px solid rgba(59, 66, 97, 0.5);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.numstat-files {
  color: var(--warning);
}

.terminal-info-pill.dragging {
  opacity: 0.5;
}

.pill-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  width: 28px;
  flex-shrink: 0;
  padding: 0;
  border-radius: 999px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.pill-minus-btn {
  background: rgba(245, 197, 66, 0.12);
  border: 1px solid rgba(245, 197, 66, 0.2);
  color: rgba(245, 197, 66, 0.9);
}

.pill-tab-close-btn {
  background: rgba(255, 85, 114, 0.12);
  border: 1px solid rgba(255, 85, 114, 0.2);
  color: rgba(255, 85, 114, 0.9);
}

@media (hover: hover) and (pointer: fine) {
  .pill-minus-btn:hover {
    background: #f5c542;
    border-color: #f5c542;
    color: #1a1b26;
  }

  .pill-tab-close-btn:hover {
    background: var(--error);
    border-color: var(--error);
    color: #fff;
  }
}

.terminal-info-pill-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.pill-icon-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
}

.pill-icon-badge-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.pill-dirty-badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f5a623;
  border: 1px solid rgba(26, 27, 38, 0.88);
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

.terminal-info-pill.pill-working {
  background-image: linear-gradient(
    90deg,
    rgba(26, 27, 38, 0.88) 0%,
    rgba(26, 27, 38, 0.88) 10%,
    rgba(100, 150, 255, 0.35) 50%,
    rgba(26, 27, 38, 0.88) 90%,
    rgba(26, 27, 38, 0.88) 100%
  );
  background-size: 200% 100%;
  animation: pill-working-pulse 2s linear infinite;
}

.terminal-pane.active .terminal-info-pill.pill-working {
  animation: none;
  background-image: none;
}

@keyframes pill-working-pulse {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

@media (pointer: coarse) {
  .terminal-frame :deep(.xterm textarea) {
    pointer-events: none !important;
  }
}

@media (min-width: 769px) {
  .pill-group {
    top: 20px;
    right: 20px;
  }

  .terminal-info-pill {
    cursor: grab;
  }

  .terminal-info-pill.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }
}

</style>
