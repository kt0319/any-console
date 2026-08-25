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
import { ref, computed, onMounted, onBeforeUnmount, type PropType } from "vue";
import { renderIconStr } from "../utils/render-icon.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { confirmCloseTab } from "../utils/tab-close-confirm.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { emit } from "../app-bridge.ts";
import { DRAG_THRESHOLD } from "../utils/constants.ts";
import { useSplitDropDrag } from "../composables/useSplitDropDrag.ts";
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
const pillEl = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const dropSide = ref("");
let closePending = false;
let lastInputWasTouch = false;

const isActive = computed(() => props.activeTabId === props.tab.id);
const canDrag = computed(() => !layoutStore.isTouchDevice && terminalStore.openTabs.length >= 1);
// タッチでのドラッグ処理そのものは全タブで有効にする。閾値を超えた時点の
// 移動方向（縦/横）で分岐する: 横方向はアクティブタブの並び替え専用（非アクティブ
// タブの横移動はタブバーのネイティブスクロールに委ねる）、縦方向はアクティブ/
// 非アクティブ問わず分割ドラッグとして扱う。長押しは不要で、閾値を超えて
// 動かした瞬間にすぐ開始する。
const canTouchDrag = computed(() => terminalStore.openTabs.length >= 1);
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
const agentStateSource = computed(() => terminalStore.agentStateSources[props.tab.sessionId] || "");

const hasPhraseNotify = computed(() => !!terminalStore.phraseNotifySessions[props.tab.sessionId]);

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
    terminalStore.clearSessionNotifyBadges(props.tab.sessionId);
    return;
  }
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
  closePending = true;
}

// PC: HTML5 Drag & Drop
function onDragStart(e: DragEvent) {
  if (!canDrag.value || closePending) { e.preventDefault(); return; }
  e.dataTransfer!.setData("text/plain", String(props.tab.id));
  e.dataTransfer!.effectAllowed = "move";
  isDragging.value = true;
  beginDrag(props.tab.id);
}

function onDragEnd(e: DragEvent) {
  isDragging.value = false;
  dropSide.value = "";
  cancelDrag();
  (e.currentTarget as HTMLElement)?.blur();
}

function resolveDragTabId(e: DragEvent) {
  const raw = layoutStore.dragTabId || e?.dataTransfer?.getData("text/plain");
  const value = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function onDragOverTab(e: DragEvent) {
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
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const isLeft = e.clientX < rect.left + rect.width / 2;
  dropSide.value = isLeft ? "left" : "right";
}

function onDragLeaveTab(e: DragEvent) {
  if ((e.currentTarget as HTMLElement)?.contains(e.relatedTarget as Node | null)) return;
  dropSide.value = "";
}

function onDropOnTab(e: DragEvent) {
  dropSide.value = "";
  if (!canDrag.value) return;
  e.preventDefault();
  const dragTabId = resolveDragTabId(e);
  if (!dragTabId || dragTabId === props.tab.id) return;

  const fromIndex = terminalStore.openTabs.findIndex((t) => t.id === dragTabId);
  const targetIndex = terminalStore.openTabs.findIndex((t) => t.id === props.tab.id);
  if (fromIndex < 0 || targetIndex < 0) return;

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const insertBefore = e.clientX < rect.left + rect.width / 2;
  let toIndex = insertBefore ? targetIndex : targetIndex + 1;
  if (fromIndex < toIndex) toIndex -= 1;
  toIndex = Math.max(0, Math.min(toIndex, terminalStore.openTabs.length - 1));
  terminalStore.moveTab(fromIndex, toIndex);

  cancelDrag();
}

// Mobile: 長押し無しで閾値を超えた瞬間にドラッグ開始し、その時点の移動方向で
// 分岐する。横移動はアクティブタブの並び替え専用（非アクティブタブの横移動は
// preventDefaultせず touch-action:pan-x のネイティブスクロールに委ねる）、
// 縦移動はアクティブ/非アクティブ問わずスプリットドラッグになる。
// クローズはタブ本体のタップ/クリックでは行わず、常に tab-close ボタン経由。
const touchTracker = createTouchTracker();
// 閾値超え時点の移動方向で確定する軸。"horizontal" = 並び替え（アクティブ
// タブのみ）、"vertical" = 分割ドラッグ（全タブ）。
const touchDragAxis = ref<"horizontal" | "vertical" | null>(null);

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

function finishTouchDrag(clientX: number, clientY: number) {
  if (touchDragAxis.value === "vertical") {
    finishSplitDrop({ tabId: props.tab.id, clientX, clientY });
    clearDragOverIndicator();
    cancelDrag();
    return;
  }
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

function onTouchStart(e: TouchEvent) {
  lastInputWasTouch = true;
  touchTracker.start(e);
  isDragging.value = false;
  touchDragAxis.value = null;
}

function onTouchMove(e: TouchEvent) {
  if (!canTouchDrag.value) return;
  if (!isDragging.value) {
    const { dx, dy } = touchTracker.delta(e);
    if (!isPastDragThreshold(dx, dy, DRAG_THRESHOLD)) return;
    const axis = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
    // 横方向はアクティブタブの並び替え専用。非アクティブタブの横移動は
    // ここで何もせず、touch-action:pan-x によるネイティブのタブバー
    // スクロールに委ねる（preventDefaultしない）。
    if (axis === "horizontal" && !isActive.value) return;
    touchDragAxis.value = axis;
    isDragging.value = true;
    beginDrag(props.tab.id);
  }
  if (e.cancelable) e.preventDefault();
  const touch = e.touches[0];
  updateHover(touch.clientX, touch.clientY);
  if (touchDragAxis.value === "vertical") return;
  const hit = hitTestTab(touch.clientX, touch.clientY);
  layoutStore.dragOverTabId = hit?.tabId ?? null;
  layoutStore.dragOverSide = hit?.side ?? "";
}

function onTouchEnd(e: TouchEvent) {
  if (isDragging.value) {
    if (e.cancelable) e.preventDefault();
    const touch = e.changedTouches[0];
    finishTouchDrag(touch.clientX, touch.clientY);
    isDragging.value = false;
  }
  touchDragAxis.value = null;
  // 長押し→そのまま離す＝クローズは廃止。クローズは tab-close ボタン経由のみ。
}

function onTouchCancel() {
  if (isDragging.value) {
    isDragging.value = false;
    clearDragOverIndicator();
    cancelDrag();
  }
  touchDragAxis.value = null;
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
/* タブピルの基本の見た目（.tab-btn / .tab-icon-slot / .tab-extra / .tab-close /
   モバイルでの justify-content）は BrowserTabItem.vue と共有するため
   ui/styles/tab-item.css（グローバル）にある。ここには DnD 並び替え・
   agent状態・dirtyバッジ等 TabItem.vue 固有の装飾だけを置く。 */

/* アクティブタブは横移動も並び替え用にJSで制御するため、pan-x（ネイティブの
   横スクロール）を許可しない。pan-xのままだと、ドラッグ閾値を超えて
   preventDefaultする前にブラウザ側が横スクロールを開始してしまい、
   並び替えが発火しなくなる（縦方向はpan-xと同様どちらにせよJS制御に
   委ねられるため、noneにしても既存の分割ドラッグに影響しない）。 */
.tab-btn {
  -webkit-touch-callout: none;
  touch-action: pan-x;
}

.tab-btn.active {
  touch-action: none;
}

.tab-btn img,
.tab-btn :deep(.mdi) {
  pointer-events: none;
  -webkit-user-drag: none;
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
