<template>
  <button
    ref="pillEl"
    class="tab-btn hover-bg"
    :class="{ active: isActive, 'tab-activity': tab._activity, 'tab-working': agentState === 'working', 'tab-blocked': agentState === 'blocked', 'tab-phrase-notify': hasPhraseNotify, dragging: isDragging, 'drag-over-left': effectiveDropSide === 'left', 'drag-over-right': effectiveDropSide === 'right', 'tab-narrow': isNarrow, 'tab-underline-active': isActive, 'tab-underline-top': isTabBarAtBottom }"
    :draggable="canDrag"
    :data-tab-id="tab.id"
    :aria-label="tabAriaLabel"
    :aria-selected="isActive ? 'true' : 'false'"
    :data-tooltip="tabTooltip"
    role="tab"
    :tabindex="isActive ? 0 : -1"
    @click="onClick"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover="onDragOverTab"
    @dragleave="onDragLeaveTab"
    @drop="onDropOnTab"
    @touchstart.passive="onTouchStart"
  >
    <span v-if="isWorktree" class="mdi mdi-file-tree worktree-icon" aria-label="worktree" data-tooltip="worktree"></span>
    <span v-if="showWsIcon" class="tab-icon-badge-wrap">
      <span v-html="wsIconHtml"></span>
      <span v-if="isDirty" class="dirty-badge" aria-label="uncommitted changes"></span>
    </span>
    <span v-if="iconHtml && !followsBaseAsWorktree" class="tab-icon-slot tab-icon-badge-wrap">
      <span v-html="iconHtml"></span>
      <span v-if="!showWsIcon && isDirty" class="dirty-badge" aria-label="uncommitted changes"></span>
    </span>
    <span class="tab-extra">
      {{ label }}
      <span
        class="tab-close hover-bg-text"
        aria-label="Close tab"
        data-tooltip="Close tab"
        draggable="false"
        @mousedown.stop.prevent="onClosePress"
        @mouseup.stop="onCloseUp"
        @click.stop.prevent
      ><span class="mdi mdi-close"></span></span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { ref, computed, type PropType } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";
import { useTabClose } from "../composables/useTabClose.ts";
import { useTabDrag } from "../composables/useTabDrag.ts";
import { useAgentStateStore } from "../stores/agent-state.ts";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";

const props = defineProps({
  tab: { type: Object as PropType<TerminalTab>, required: true },
  activeTabId: { type: Number as PropType<number | null>, default: null },
  isTabBarAtBottom: { type: Boolean, default: false },
  isNarrow: { type: Boolean, default: false },
  inGroup: { type: Boolean, default: false },
  followsBase: { type: Boolean, default: false },
});

const emits = defineEmits(["select"]);
const { confirmAndCloseTab } = useTabClose();
const terminalStore = useTerminalStore();
const agentStateStore = useAgentStateStore();
const workspaceStore = useWorkspaceStore();
const pillEl = ref<HTMLElement | null>(null);
let closePending = false;

const isActive = computed(() => props.activeTabId === props.tab.id);
const {
  canDrag,
  isDragging,
  effectiveDropSide,
  onDragStart,
  onDragEnd,
  onDragOverTab,
  onDragLeaveTab,
  onDropOnTab,
  onTouchStart,
  consumeLastInputWasTouch,
} = useTabDrag({
  tabId: () => props.tab.id,
  pillEl,
  isClosePending: () => closePending,
});

// tab は markRaw のため tab.workspace の変更は追跡されない。tabWorkspaceVersion を読んで依存に含める。
const tabWorkspace = computed(() => {
  terminalStore.tabWorkspaceVersion;
  return props.tab.workspace ? workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace) : undefined;
});

const followsBaseAsWorktree = computed(() => !!tabWorkspace.value?.worktree && props.inGroup && props.followsBase);

const label = computed(() => {
  // workspace が falsy でも必ず依存させる（読まないと依存が空になり再評価されない）
  terminalStore.tabWorkspaceVersion;
  if (props.tab.workspace) {
    const ws = tabWorkspace.value;
    // worktree アイコンで判別できるためベース名だけ。ベースの右に続く時はブランチ名
    if (ws?.worktree) {
      if (followsBaseAsWorktree.value && ws.branch) return ws.branch;
      return ws.worktree_base || props.tab.workspace;
    }
    return props.tab.workspace;
  }
  return props.tab.label || "terminal";
});

const isDirty = computed(() => tabWorkspace.value?.clean === false);

const agentState = computed(() => agentStateStore.agentStates[props.tab.sessionId] || "");
const agentStateSource = computed(() => agentStateStore.agentStateSources[props.tab.sessionId] || "");

const hasPhraseNotify = computed(() => !!agentStateStore.phraseNotifySessions[props.tab.sessionId]);

const tabAriaLabel = computed(() => (hasPhraseNotify.value ? `${label.value} (phrase detected)` : label.value));

// agent detection の判定元はデバッグ用なので aria-label には含めず tooltip だけに足す
const tabTooltip = computed(() => (
  agentState.value && agentStateSource.value
    ? `${tabAriaLabel.value} · ${agentState.value} (${agentStateSource.value})`
    : tabAriaLabel.value
));

const isWorktree = computed(() => !!tabWorkspace.value?.worktree);

const iconSize = 18;

// tab.wsIcon / tab.icon は markRaw 越しだと変更を検知できないため tabWorkspaceVersion に依存させる
const wsIconHtml = computed(() => {
  terminalStore.tabWorkspaceVersion;
  if (props.tab.wsIcon) return renderIconStr(props.tab.wsIcon.name, props.tab.wsIcon.color, iconSize);
  return "";
});

// グループ表示中の worktree はベースと同じアイコンを出さない
const showWsIcon = computed(() => !!wsIconHtml.value && !(isWorktree.value && props.inGroup));

const iconHtml = computed(() => {
  terminalStore.tabWorkspaceVersion;
  if (props.tab.icon) return renderIconStr(props.tab.icon.name, props.tab.icon.color, iconSize);
  return "";
});


function onClick(e: MouseEvent) {
  if (isDragging.value) return;
  (e.currentTarget as HTMLElement)?.blur();
  if (isActive.value) {
    // 既にアクティブだと select が発火せず switchTab() を通らないため、ここでバッジをクリアする
    agentStateStore.clearSessionNotifyBadges(props.tab.sessionId);
    return;
  }
  // タッチ選択ではソフトキーボードが誤起動するためフォーカスしない
  emits("select", props.tab, { skipFocus: consumeLastInputWasTouch() });
}

async function onClose() {
  closePending = false;
  await confirmAndCloseTab(props.tab);
}

function onCloseUp() {
  if (!closePending) return;
  onClose();
}

function onClosePress() {
  closePending = true;
}

</script>

<style scoped>
.tab-btn {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  padding: 9px 16px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
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
  color: var(--text-primary);
  background: var(--accent-bg-12);
}

/* 通常ホバーは base.css の .hover-bg。アクティブタブはホバーでも強調色を維持 */
@media (hover: hover) and (pointer: fine) {
  .tab-btn.active:hover {
    background: var(--accent-bg-12);
  }
}

.tab-btn.tab-activity {
  animation: tab-activity-glow 3s ease-in-out 1;
}

.tab-btn.dragging {
  opacity: 0.5;
  cursor: grabbing;
  touch-action: none;
}

/* 隣り合う非アクティブタブの間の縦線。gap(7px)の中央に来るよう -4px ずらす */
.tab-btn:not(.active) + .tab-btn:not(.active)::before {
  content: "";
  position: absolute;
  left: -4px;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--border);
}

.tab-btn.drag-over-left {
  box-shadow: inset 2px 0 0 var(--accent);
}

.tab-btn.drag-over-right {
  box-shadow: inset -2px 0 0 var(--accent);
}

/* ダーティマークはアイコンの右下にバッジとして重ねる */
.tab-icon-badge-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.tab-narrow { justify-content: center; }

.tab-icon-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  flex-shrink: 0;
}

.tab-extra {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  line-height: 1;
}

/* 狭い時はラベルを畳む。max-height も 0 にしないと .tab-close(24px固定)がタブ高さを押し上げる */
.tab-btn.tab-narrow .tab-extra {
  max-width: 0;
  max-height: 0;
  margin-left: -6px;
  opacity: 0;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
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

.tab-btn.tab-narrow :deep(.favicon-icon) {
  width: 20px;
  height: 20px;
}

@keyframes tab-activity-glow {
  0%, 100% { background: transparent; }
  50% { background: rgba(130, 170, 255, 0.25); }
}

/* tab-working / tab-phrase-notify / tab-blocked の点滅は base.css でセッションサイドバー行と共用 */

</style>
