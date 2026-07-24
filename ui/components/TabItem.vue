<template>
  <button
    ref="pillEl"
    class="tab-btn"
    :class="{ active: isActive, 'tab-activity': tab._activity, 'tab-working': agentState === 'working', dragging: isDragging, 'drag-over-left': effectiveDropSide === 'left', 'drag-over-right': effectiveDropSide === 'right', 'tab-panel-bottom': isPanelBottom }"
    :draggable="canDrag"
    :data-tab-id="tab.id"
    tabindex="-1"
    @mousedown="onMouseDown"
    @click="onClick"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover="onDragOverTab"
    @dragleave="onDragLeaveTab"
    @drop="onDropOnTab"
    @touchstart.passive="onTouchStart"
  >
    <span v-if="wsIconHtml" v-html="wsIconHtml"></span>
    <span v-if="isWorktree" class="mdi mdi-file-tree tab-worktree-icon" aria-label="worktree" data-tooltip="worktree"></span>
    <span v-if="iconHtml" class="tab-icon-slot">
      <span v-html="iconHtml"></span>
    </span>
    <template v-if="!isPanelBottom">
      {{ label }}
      <span class="tab-dirty-dot" :style="{ visibility: isDirty ? 'visible' : 'hidden' }" :aria-hidden="!isDirty" aria-label="uncommitted changes"></span>
      <span
        class="tab-close"
        draggable="false"
        @mousedown.stop.prevent="onClosePress"
        @touchstart.stop.prevent="onClosePress"
        @mouseup.stop="onCloseUp"
        @click.stop.prevent
      >&times;</span>
    </template>
    <span v-if="isPanelBottom && isDirty" class="tab-dirty-dot" aria-label="uncommitted changes"></span>
  </button>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { renderIconStr } from "../utils/render-icon.js";
import { workspaceDisplayName } from "../utils/worktree.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";
import { DRAG_THRESHOLD, LONG_PRESS_MS } from "../utils/constants.js";
import { useSplitDropDrag } from "../composables/useSplitDropDrag.js";
import { useLongPress } from "../composables/useLongPress.js";
import { isPastDragThreshold, createTouchTracker } from "../utils/gesture.js";

const props = defineProps({
  tab: { type: Object, required: true },
  activeTabId: { type: Number, default: null },
  isPanelBottom: { type: Boolean, default: false },
});

const emits = defineEmits(["select", "close", "refresh"]);
const layoutStore = useLayoutStore();
const { confirm } = useConfirm();
const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const { beginDrag, updateHover, finishSplitDrop, cancelDrag } = useSplitDropDrag();
const mouseLongPress = useLongPress(LONG_PRESS_MS);
const touchLongPress = useLongPress(LONG_PRESS_MS);
const pillEl = ref(null);
const isDragging = ref(false);
const dropSide = ref("");
let closePending = false;

const isActive = computed(() => props.activeTabId === props.tab.id);
const canDrag = computed(() => !layoutStore.isTouchDevice && terminalStore.openTabs.length >= 1);
const canTouchDrag = computed(() => terminalStore.openTabs.length >= 1);
const effectiveDropSide = computed(() => {
  if (layoutStore.dragOverTabId === props.tab.id) return layoutStore.dragOverSide;
  return dropSide.value;
});

const label = computed(() => {
  if (props.tab.workspace) {
    const ws = workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace);
    if (ws?.worktree) return workspaceDisplayName(ws);
    return props.tab.workspace;
  }
  return props.tab.label || "terminal";
});

const isDirty = computed(() => {
  if (!props.tab.workspace) return false;
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace);
  return ws?.clean === false;
});

const agentState = computed(() => terminalStore.agentStates[props.tab.sessionId] || "");

const isWorktree = computed(() => {
  if (!props.tab.workspace) return false;
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace);
  return !!ws?.worktree;
});

const wsIconHtml = computed(() => {
  if (props.tab.wsIcon) return renderIconStr(props.tab.wsIcon.name, props.tab.wsIcon.color, 18);
  return "";
});

const iconHtml = computed(() => {
  if (props.tab.icon) return renderIconStr(props.tab.icon.name, props.tab.icon.color, 18);
  return "";
});


function onClick(e) {
  mouseLongPress.cancel();
  if (isDragging.value) return;
  if (mouseLongPress.consumeFired()) return;
  e.currentTarget?.blur();
  if (isActive.value) return;
  emits("select", props.tab);
}

async function onClose() {
  closePending = false;
  const result = await confirmCloseTab(confirm, props.tab);
  if (result === true) emits("close", props.tab);
  else if (result === "refresh") emits("refresh", props.tab);
}

function onCloseUp() {
  if (!closePending) return;
  onClose();
}

function onClosePress() {
  mouseLongPress.cancel();
  touchLongPress.cancel();
  closePending = true;
}

function onMouseDown() {
  if (layoutStore.isTouchDevice) return;
  mouseLongPress.start(onClose);
}

// PC: HTML5 Drag & Drop
function onDragStart(e) {
  mouseLongPress.cancel();
  if (!canDrag.value || closePending) { e.preventDefault(); return; }
  e.dataTransfer.setData("text/plain", props.tab.id);
  e.dataTransfer.effectAllowed = "move";
  isDragging.value = true;
  beginDrag(props.tab.id);
}

function onDragEnd(e) {
  isDragging.value = false;
  dropSide.value = "";
  cancelDrag();
  e.currentTarget?.blur();
}

function resolveDragTabId(e) {
  const raw = layoutStore.dragTabId || e?.dataTransfer?.getData("text/plain");
  const value = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function onDragOverTab(e) {
  if (!canDrag.value) return;
  const dragTabId = resolveDragTabId(e);
  if (!dragTabId || dragTabId === props.tab.id) {
    dropSide.value = "";
    return;
  }
  const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === dragTabId);
  const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === props.tab.id);
  if (fromIndex < 0 || targetIndex < 0) {
    dropSide.value = "";
    return;
  }
  e.preventDefault();
  const rect = e.currentTarget.getBoundingClientRect();
  const isLeft = e.clientX < rect.left + rect.width / 2;
  dropSide.value = isLeft ? "left" : "right";
}

function onDragLeaveTab(e) {
  if (e.currentTarget?.contains(e.relatedTarget)) return;
  dropSide.value = "";
}

function onDropOnTab(e) {
  dropSide.value = "";
  if (!canDrag.value) return;
  e.preventDefault();
  const dragTabId = resolveDragTabId(e);
  if (!dragTabId || dragTabId === props.tab.id) return;

  const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === dragTabId);
  const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === props.tab.id);
  if (fromIndex < 0 || targetIndex < 0) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const insertBefore = e.clientX < rect.left + rect.width / 2;
  let toIndex = insertBefore ? targetIndex : targetIndex + 1;
  if (fromIndex < toIndex) toIndex -= 1;
  toIndex = Math.max(0, Math.min(toIndex, terminalStore.openTabs.length - 1));
  terminalStore.moveTab(fromIndex, toIndex);

  cancelDrag();
}

// Mobile: 短いスワイプ=ネイティブ横スクロール、長押し→そのまま離す=閉じる、
// 長押し→動かす=ドラッグ（横移動で並び替え、タブバー外へドラッグでスプリット）
const touchTracker = createTouchTracker();

function hitTestTab(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const btn = el?.closest?.(".tab-btn[data-tab-id]");
  if (!btn) return null;
  const tabId = Number(btn.dataset.tabId);
  if (!Number.isFinite(tabId) || tabId === props.tab.id) return null;
  const rect = btn.getBoundingClientRect();
  const side = clientX < rect.left + rect.width / 2 ? "left" : "right";
  return { tabId, side };
}

function clearDragOverIndicator() {
  layoutStore.dragOverTabId = null;
  layoutStore.dragOverSide = "";
}

function finishTouchDrag(clientX, clientY) {
  const hit = hitTestTab(clientX, clientY);
  if (hit) {
    const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === props.tab.id);
    const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === hit.tabId);
    if (fromIndex >= 0 && targetIndex >= 0) {
      let toIndex = hit.side === "left" ? targetIndex : targetIndex + 1;
      if (fromIndex < toIndex) toIndex -= 1;
      toIndex = Math.max(0, Math.min(toIndex, terminalStore.openTabs.length - 1));
      terminalStore.moveTab(fromIndex, toIndex);
    }
  } else {
    finishSplitDrop({
      tabId: props.tab.id,
      clientX, clientY,
      openTabs: terminalStore.openTabs,
      activeTabId: terminalStore.activeTabId,
    });
  }
  clearDragOverIndicator();
  cancelDrag();
}

function onTouchStart(e) {
  touchTracker.start(e);
  touchLongPress.reset();
  isDragging.value = false;
  touchLongPress.start(() => {});
}

function onTouchMove(e) {
  const { dx, dy } = touchTracker.delta(e);
  if (!touchLongPress.isFired()) {
    if (isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) {
      touchLongPress.cancel();
    }
    return;
  }
  if (!isDragging.value) {
    if (!isPastDragThreshold(dx, dy, DRAG_THRESHOLD) || !canTouchDrag.value) return;
    isDragging.value = true;
    beginDrag(props.tab.id);
  }
  if (e.cancelable) e.preventDefault();
  const touch = e.touches[0];
  updateHover(touch.clientX, touch.clientY);
  const hit = hitTestTab(touch.clientX, touch.clientY);
  layoutStore.dragOverTabId = hit?.tabId ?? null;
  layoutStore.dragOverSide = hit?.side ?? "";
}

function onTouchEnd(e) {
  touchLongPress.cancel();
  const fired = touchLongPress.consumeFired();
  if (isDragging.value) {
    if (e.cancelable) e.preventDefault();
    const touch = e.changedTouches[0];
    finishTouchDrag(touch.clientX, touch.clientY);
    isDragging.value = false;
    return;
  }
  if (fired) onClose();
}

function onTouchCancel() {
  touchLongPress.cancel();
  touchLongPress.consumeFired();
  if (isDragging.value) {
    isDragging.value = false;
    clearDragOverIndicator();
    cancelDrag();
  }
}

onMounted(() => {
  const el = pillEl.value;
  if (!el) return;
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd, { passive: false });
  el.addEventListener("touchcancel", onTouchCancel);
});

onBeforeUnmount(() => {
  const el = pillEl.value;
  if (!el) return;
  el.removeEventListener("touchmove", onTouchMove);
  el.removeEventListener("touchend", onTouchEnd);
  el.removeEventListener("touchcancel", onTouchCancel);
});
</script>

<style scoped>
.tab-btn {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius) var(--radius) 0 0;
  background: var(--bg-primary);
  color: var(--text-muted);
  font-size: 12px;
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: pan-x;
}

.tab-btn img,
.tab-btn :deep(.mdi) {
  pointer-events: none;
  -webkit-user-drag: none;
}

.tab-btn.active {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.tab-btn.tab-activity {
  animation: tab-activity-glow 3s ease-in-out 1;
}

.tab-btn.dragging {
  opacity: 0.5;
  cursor: grabbing;
  touch-action: none;
}

.tab-btn.drag-over-left {
  box-shadow: inset 2px 0 0 var(--accent);
}

.tab-btn.drag-over-right {
  box-shadow: inset -2px 0 0 var(--accent);
}

.tab-dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5a623;
  flex-shrink: 0;
}

.tab-worktree-icon {
  font-size: 13px;
  color: var(--accent);
  flex-shrink: 0;
}

.tab-panel-bottom { justify-content: center; }

.tab-icon-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  flex-shrink: 0;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}

.tab-btn :deep(.favicon-icon) {
  width: 18px;
  height: 18px;
  pointer-events: none;
  -webkit-touch-callout: none;
}

@keyframes tab-activity-glow {
  0%, 100% { background: var(--bg-primary); }
  50% { background: rgba(130, 170, 255, 0.25); }
}

.tab-btn.tab-working:not(.active) {
  background-image: linear-gradient(
    90deg,
    var(--bg-primary) 0%,
    var(--bg-primary) 10%,
    rgba(130, 170, 255, 0.2) 50%,
    var(--bg-primary) 90%,
    var(--bg-primary) 100%
  );
  background-size: 200% 100%;
  animation: tab-working-pulse 2s linear infinite;
}

@keyframes tab-working-pulse {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}
</style>
