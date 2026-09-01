<template>
  <button
    ref="pillEl"
    class="tab-btn hover-bg"
    :class="{ active: isActive, 'tab-activity': tab._activity, 'tab-working': agentState === 'working', 'tab-blocked': agentState === 'blocked', 'tab-phrase-notify': hasPhraseNotify, dragging: isDragging, 'drag-over-left': effectiveDropSide === 'left', 'drag-over-right': effectiveDropSide === 'right', 'tab-panel-bottom': isPanelBottom, 'tab-underline-active': isActive, 'tab-underline-top': isPanelBottom }"
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
    <span v-if="wsIconHtml" class="tab-icon-badge-wrap">
      <span v-html="wsIconHtml"></span>
      <span v-if="isDirty" class="tab-dirty-badge" aria-label="uncommitted changes"></span>
    </span>
    <span v-if="iconHtml" class="tab-icon-slot tab-icon-badge-wrap">
      <span v-html="iconHtml"></span>
      <span v-if="!wsIconHtml && isDirty" class="tab-dirty-badge" aria-label="uncommitted changes"></span>
    </span>
    <span v-if="isWorktree" class="mdi mdi-file-tree tab-worktree-icon" aria-label="worktree" data-tooltip="worktree"></span>
    <span class="tab-extra">
      {{ label }}
      <span
        class="tab-close hover-bg-text"
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
  isPanelBottom: { type: Boolean, default: false },
});

const emits = defineEmits(["select"]);
const { confirmAndCloseTab } = useTabClose();
const terminalStore = useTerminalStore();
const agentStateStore = useAgentStateStore();
const workspaceStore = useWorkspaceStore();
const pillEl = ref<HTMLElement | null>(null);
let closePending = false;

const isActive = computed(() => props.activeTabId === props.tab.id);
// ドラッグ操作（PC DnD + タッチ）は useTabDrag に集約。
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

// tab は markRaw のため tab.workspace 単体の変更は追跡されない。Add で
// ベアターミナルにワークスペースを紐付けた直後もタブラベルに反映されるよう、
// tabWorkspaceVersion を読んで依存に含める（TerminalPane.vue の
// paneWorkspace と同じ理由）。label/isDirty/isWorktree はこの computed を
// 共有して同じ検索を繰り返さない。
const tabWorkspace = computed(() => {
  terminalStore.tabWorkspaceVersion;
  return props.tab.workspace ? workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace) : undefined;
});

const label = computed(() => {
  // props.tab.workspaceがfalsyな実行では下のtabWorkspace.value（読めば
  // tabWorkspaceVersionへ依存する）を一度も読まないまま返ってしまい、
  // このcomputed自体の依存が空になって二度と再評価されなくなる
  // （ベアターミナル→Add/自動紐付けでworkspaceが後から付いても
  // ラベルが更新されなかった不具合の原因）。分岐に関係なく必ず依存させる。
  terminalStore.tabWorkspaceVersion;
  if (props.tab.workspace) {
    const ws = tabWorkspace.value;
    // worktreeアイコン(tab-worktree-icon)で既に判別できるため、タブ名には
    // worktree名（"ベース名 | ブランチ"）を出さずベース名だけにする。
    if (ws?.worktree) return ws.worktree_base || props.tab.workspace;
    return props.tab.workspace;
  }
  return props.tab.label || "terminal";
});

const isDirty = computed(() => tabWorkspace.value?.clean === false);

const agentState = computed(() => agentStateStore.agentStates[props.tab.sessionId] || "");
const agentStateSource = computed(() => agentStateStore.agentStateSources[props.tab.sessionId] || "");

const hasPhraseNotify = computed(() => !!agentStateStore.phraseNotifySessions[props.tab.sessionId]);

const tabAriaLabel = computed(() => (hasPhraseNotify.value ? `${label.value} (phrase detected)` : label.value));

// data-tooltip限定でagent detectionの判定元を追記する（デバッグ用途。
// aria-labelには含めない — スクリーンリーダー利用者に無関係な内部情報の
// 読み上げを増やさないため）。
const tabTooltip = computed(() => (
  agentState.value && agentStateSource.value
    ? `${tabAriaLabel.value} · ${agentState.value} (${agentStateSource.value})`
    : tabAriaLabel.value
));

const isWorktree = computed(() => !!tabWorkspace.value?.worktree);

const iconSize = 18;

// labelと同じ理由でtabWorkspaceVersionへ明示的に依存させる
// （setTabWorkspace/setTabJobが直接書き換えるtab.wsIcon/tab.iconは
// markRaw越しの読み取りだけでは変更を検知できない）。
const wsIconHtml = computed(() => {
  terminalStore.tabWorkspaceVersion;
  if (props.tab.wsIcon) return renderIconStr(props.tab.wsIcon.name, props.tab.wsIcon.color, iconSize);
  return "";
});

const iconHtml = computed(() => {
  terminalStore.tabWorkspaceVersion;
  if (props.tab.icon) return renderIconStr(props.tab.icon.name, props.tab.icon.color, iconSize);
  return "";
});


function onClick(e: MouseEvent) {
  if (isDragging.value) return;
  (e.currentTarget as HTMLElement)?.blur();
  if (isActive.value) {
    // 既にアクティブなタブ（開いているタブが1つしかない場合等）は select が
    // 発火しない = switchTab() を経由しないため、ここで明示的にバッジをクリアする。
    agentStateStore.clearSessionNotifyBadges(props.tab.sessionId);
    return;
  }
  // タッチ操作での選択はソフトキーボードが誤起動するため、フォーカスしない。
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

/* 通常ホバーは base.css の .hover-bg（テンプレート側で付与）。アクティブタブは
   ホバーでもアクティブ強調色を維持する。 */
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

/* Chromeのタブと同じく、隣り合う2つの非アクティブタブの間に縦線を出す
   （アクティブタブに隣接する側は出さない）。gap（.tab-bar-tabsで7px）の
   中央に来るよう -(gap+線幅)/2 = -4px ずらす。 */
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

/* ダーティマークはワークスペースアイコン（無ければjobアイコン）の右下に
   バッジとして重ねる。アイコン自体はアクティブ/非アクティブで常に表示
   され続けるため、ラベルの開閉アニメーションとは独立して安定した位置に出せる。 */
.tab-icon-badge-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.tab-dirty-badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f5a623;
  border: 1px solid var(--bg-secondary);
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

.tab-extra {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  line-height: 1;
}

/* モバイル(パネル下部)はアイコンのみ表示にするため、ラベルは常に畳む。 */
.tab-btn.tab-panel-bottom .tab-extra {
  max-width: 0;
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

.tab-btn.tab-panel-bottom :deep(.favicon-icon) {
  width: 20px;
  height: 20px;
}

@keyframes tab-activity-glow {
  0%, 100% { background: transparent; }
  50% { background: rgba(130, 170, 255, 0.25); }
}

/* tab-working（出力中）のグラデーションと tab-phrase-notify / tab-blocked の
   通知点滅は ui/styles/base.css（グローバル）でセッションサイドバー行と
   共用する。どちらも同じ青の点滅で「このタブに注目」だけを伝え、種類は
   タブを開いて確認する割り切り。ドット追加だと dirty-dot と場所を取り合う
   （特にパネル下部のアイコンのみ表示）ため、幅を取らない背景の演出にする。 */

</style>
