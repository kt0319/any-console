<template>
  <button
    ref="pillEl"
    class="tab-btn hover-bg"
    :class="{ active: isActive, 'tab-activity': tab._activity, 'tab-working': agentState === 'working', 'tab-blocked': agentState === 'blocked', 'tab-phrase-notify': hasPhraseNotify, dragging: isDragging, 'drag-over-left': effectiveDropSide === 'left', 'drag-over-right': effectiveDropSide === 'right', 'tab-panel-bottom': isPanelBottom, 'tab-underline-active': isActive, 'tab-underline-top': isPanelBottom }"
    :draggable="canDrag"
    :data-tab-id="tab.id"
    :aria-label="tabAriaLabel"
    :aria-selected="isActive ? 'true' : 'false'"
    :data-tooltip="tabAriaLabel"
    role="tab"
    :tabindex="isActive ? 0 : -1"
    @mousedown="onMouseDown"
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
import { ref, computed, onMounted, onBeforeUnmount, type PropType } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { confirmCloseTab } from "../utils/tab-close-confirm.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { emit } from "../app-bridge.ts";
import { DRAG_THRESHOLD, LONG_PRESS_MS } from "../utils/constants.ts";
import { useSplitDropDrag } from "../composables/useSplitDropDrag.ts";
import { useLongPress } from "../composables/useLongPress.ts";
import { isPastDragThreshold, createTouchTracker } from "../utils/gesture.ts";

const props = defineProps({
  tab: { type: Object as PropType<TerminalTab>, required: true },
  activeTabId: { type: Number as PropType<number | null>, default: null },
  isPanelBottom: { type: Boolean, default: false },
});

const emits = defineEmits(["select", "close", "refresh", "detach"]);
const layoutStore = useLayoutStore();
const { confirm } = useConfirm();
const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const { beginDrag, updateHover, finishSplitDrop, cancelDrag } = useSplitDropDrag();
const mouseLongPress = useLongPress(LONG_PRESS_MS);
const pillEl = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const dropSide = ref("");
let closePending = false;
let lastInputWasTouch = false;

const isActive = computed(() => props.activeTabId === props.tab.id);
const canDrag = computed(() => !layoutStore.isTouchDevice && terminalStore.openTabs.length >= 1);
// タッチでのドラッグはアクティブタブのみ許可する（非アクティブタブは横スワイプで
// タブバーをスクロールする操作と誤認識しやすいため）。アクティブタブは長押し
// 不要で、閾値を超えて動かした瞬間にすぐドラッグを開始する。
const canTouchDrag = computed(() => isActive.value && terminalStore.openTabs.length >= 1);
const effectiveDropSide = computed(() => {
  if (layoutStore.dragOverTabId === props.tab.id) return layoutStore.dragOverSide;
  return dropSide.value;
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

const agentState = computed(() => terminalStore.agentStates[props.tab.sessionId] || "");

const hasPhraseNotify = computed(() => !!terminalStore.phraseNotifySessions[props.tab.sessionId]);

const tabAriaLabel = computed(() => (hasPhraseNotify.value ? `${label.value} (phrase detected)` : label.value));

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


function onClick(e) {
  mouseLongPress.cancel();
  if (isDragging.value) return;
  if (mouseLongPress.consumeFired()) return;
  e.currentTarget?.blur();
  if (isActive.value) return;
  // タッチ操作での選択はソフトキーボードが誤起動するため、フォーカスしない。
  const skipFocus = lastInputWasTouch;
  lastInputWasTouch = false;
  emits("select", props.tab, { skipFocus });
}

async function onClose() {
  closePending = false;
  const result = await confirmCloseTab(confirm, props.tab);
  if (result === true) emits("close", props.tab);
  else if (result === "refresh") emits("refresh", props.tab);
  else if (result === "detach") emits("detach", props.tab);
}

function onCloseUp() {
  if (!closePending) return;
  onClose();
}

function onClosePress() {
  mouseLongPress.cancel();
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

// Mobile: アクティブタブのみ、長押し無しで閾値を超えた瞬間にドラッグ開始
// （横移動で並び替え、タブバー外へドラッグでスプリット）。非アクティブタブは
// canTouchDrag が false になりドラッグ自体が始まらない（横スワイプでの
// タブバースクロールと誤認識しないようにするため）。
// クローズはタブ本体のタップ/クリックでは行わず、常に tab-close ボタン経由。
const touchTracker = createTouchTracker();

function hitTestTab(clientX: number, clientY: number) {
  const el = document.elementFromPoint(clientX, clientY);
  const btn = el?.closest?.<HTMLElement>(".tab-btn[data-tab-id]");
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
    finishSplitDrop({ tabId: props.tab.id, clientX, clientY });
  }
  clearDragOverIndicator();
  cancelDrag();
}

function onTouchStart(e) {
  lastInputWasTouch = true;
  touchTracker.start(e);
  isDragging.value = false;
}

function onTouchMove(e) {
  if (!canTouchDrag.value) return;
  if (!isDragging.value) {
    const { dx, dy } = touchTracker.delta(e);
    if (!isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) return;
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
  if (isDragging.value) {
    if (e.cancelable) e.preventDefault();
    const touch = e.changedTouches[0];
    finishTouchDrag(touch.clientX, touch.clientY);
    isDragging.value = false;
  }
  // 長押し→そのまま離す＝クローズは廃止。クローズは tab-close ボタン経由のみ。
}

function onTouchCancel() {
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
  font-size: 16px;
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
