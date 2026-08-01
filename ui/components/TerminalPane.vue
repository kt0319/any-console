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
      <div
        class="pill-group"
        ref="pillEl"
        :class="{ 'no-transition': suppressPillRightTransition }"
        :style="{ right: pillGroupRight }"
      >
        <div
          class="terminal-info-pill"
          ref="infoPillEl"
          :class="{ 'tab-activity': tab._activity, 'pill-working': agentState === 'working', dragging: pillDragging, 'pill-collapsed': isMobile && !pillExpanded }"
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
            <span v-if="!isPaneNarrow" class="pill-workspace-label">{{ tab.workspace || tab.label || '' }}</span>
          </span>
        </div>
        <div class="pill-trailing" ref="trailingEl">
          <TransitionGroup name="pill-pop">
            <button
              v-if="isMobile && !pillExpanded && showMoreBtn"
              key="more"
              type="button"
              class="pill-more-btn"
              aria-label="Show more"
              data-tooltip="Show more"
              @pointerdown.stop
              @click.stop="pillExpanded = true"
            ><span class="mdi mdi-dots-horizontal"></span></button>
            <button
              v-if="effectivePillExpanded && isGitRepo"
              key="branch"
              type="button"
              class="pill-branch-btn"
              aria-label="Branches"
              data-tooltip="Branches"
              @pointerdown.stop
              @click.stop="openBranch"
            >
              <span class="mdi mdi-source-branch"></span>
              <span class="pill-branch-text"><span v-if="branchParts.abbr" class="branch-abbr">{{ branchParts.abbr }}</span>{{ branchParts.rest }}</span>
            </button>
            <button
              v-if="effectivePillExpanded && isDirty"
              key="changes"
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
            <GitActionBtn
              v-if="effectivePillExpanded && behind > 0"
              key="pull"
              icon="pull"
              title="Pull"
              :count="behind"
              :running="isRunning(tab.workspace, 'pull')"
              btn-class="pull-btn has-count"
              @pointerdown.stop
              @action="doAction('pull')"
            />
            <GitActionBtn
              v-if="effectivePillExpanded && ahead > 0"
              key="push"
              icon="push"
              title="Push"
              :count="ahead"
              :running="isRunning(tab.workspace, 'push')"
              btn-class="push-btn has-count"
              @pointerdown.stop
              @action="doAction('push')"
            />
            <button
              v-if="effectivePillExpanded && devServerEntry"
              key="devserver"
              type="button"
              class="pill-devserver-btn"
              aria-label="Dev Server"
              data-tooltip="Dev Server"
              @pointerdown.stop
              @click.stop="openDevServer"
            >
              <span class="mdi mdi-server"></span>
              <span class="pill-devserver-text">Server</span>
            </button>
            <button
              v-if="layoutStore.isSplitMode"
              key="minus"
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
              key="close"
              type="button"
              class="pill-close-btn pill-tab-close-btn"
              aria-label="Close tab"
              data-tooltip="Close tab"
              @pointerdown.stop="onTabCloseDown"
              @pointerup.stop="onTabCloseUp"
              @click.stop
            >&times;</button>
          </TransitionGroup>
        </div>
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
import { ACTIVE_FIT_DELAY_MS, PILL_POP_LEAVE_MS } from "../utils/constants.js";
import { usePillDrag } from "../composables/usePillDrag.js";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useTerminalPaste } from "../composables/useTerminalPaste.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import { useTerminalPaneGestures } from "../composables/useTerminalPaneGestures.js";
import { useCircleKeyPad } from "../composables/useCircleKeyPad.js";
import { useWorkspaceGitStatus } from "../composables/useWorkspaceGitStatus.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useIsMobile } from "../composables/useIsMobile.js";
import { useApi } from "../composables/useApi.js";
import CircleKeyPad from "./CircleKeyPad.vue";
import StatusOverlay from "./StatusOverlay.vue";
import GitActionBtn from "./GitActionBtn.vue";
import { buildReconnectLabel } from "../utils/terminal-ws.js";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.js";
import { EP_PREVIEW_PORTS } from "../utils/endpoints.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const { confirm } = useConfirm();
const { isMobile } = useIsMobile();
const { apiGet } = useApi();

const paneWorkspace = computed(() =>
  props.tab.workspace ? workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace) : undefined,
);
// 分割モードでは WorkspaceStatusBar（アクティブタブ1つ分の表示）が隠れるため、
// ペインごとの git 情報（変更行数・ahead/behind）をピルに直接出す。
const { isDirty, isGitRepo, ahead, behind, changedFiles, insertions, deletions, branchParts } = useWorkspaceGitStatus(paneWorkspace, isMobile);
const { gitAction, isRunning } = useGitRemoteAction();

function doAction(action) {
  const wsName = props.tab.workspace;
  if (!wsName) return;
  gitAction(wsName, action, { branch: paneWorkspace.value?.branch || "" });
}

// WorkspaceStatusBar と同じ理由（分割モードでは隠れる）で Dev Server ボタンもピルに直接出す。
const previewPorts = ref(/** @type {Record<string, any>[]} */ ([]));
let previewTimer = null;

async function fetchPreviewPorts() {
  if (!props.tab.workspace) { previewPorts.value = []; return; }
  const { ok, data } = await apiGet(EP_PREVIEW_PORTS);
  if (ok && Array.isArray(data)) previewPorts.value = data;
}

function startPreviewPolling() {
  stopPreviewPolling();
  fetchPreviewPorts();
  previewTimer = setInterval(() => {
    if (document.hidden) return;
    fetchPreviewPorts();
  }, DEV_SERVER_POLL_INTERVAL_MS);
}

function stopPreviewPolling() {
  if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
}

const devServerEntry = computed(() =>
  previewPorts.value.find((p) => p.workspace === props.tab.workspace && p.proxy_port) || null,
);

async function openDevServer() {
  const p = devServerEntry.value;
  if (!p) return;
  const url = `${p.scheme || "http"}://${location.hostname}:${p.proxy_port}/`;
  const ok = await confirm(`Open dev server preview at "${url}"?`, {
    ok: { label: "Open" },
  });
  if (!ok) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openChanges() {
  if (!props.tab.workspace) return;
  workspaceStore.selectedWorkspace = props.tab.workspace;
  emit("git:openFileModal", { pane: "changes" });
}

function openBranch() {
  if (!props.tab.workspace) return;
  workspaceStore.selectedWorkspace = props.tab.workspace;
  emit("git:openFileModal", { pane: "branch" });
}

const agentState = computed(() => terminalStore.agentStates[props.tab.sessionId] || "");
const { ensureTerminalOpened, fitTerminal, sendResize, observeFrameResize, connectTerminalWs } = useTerminal();

const paneEl = ref(null);
const frameEl = ref(null);
const pillEl = ref(null);
const infoPillEl = ref(null);
const trailingEl = ref(null);
let activeFitTimer = null;

// ピル本体（アイコン・ワークスペース名・ahead/behind。展開ボタン群は含まない）が
// ペイン幅の半分以上を占有したら、ワークスペース名を省いてスペースを優先する。
// 名前を隠すとピル自体が縮んで判定条件から外れてしまう（表示/非表示のバタつき）ため、
// 「最後に名前込みで表示できていた時のピル幅」を基準にヒステリシスを持たせる。
// 　- 表示中: ピル幅を都度記録し、ペイン幅の半分を超えたら隠す
// 　- 非表示中: 記録済みのピル幅がペイン幅の半分以内に収まるようになったら再表示する
const isPaneNarrow = ref(false);
let lastShownPillWidth = 0;
let paneWidth = 0;
let pillWidth = 0;
let roPane = null;

function updatePaneNarrow() {
  if (!paneWidth) return;
  if (!isPaneNarrow.value) {
    lastShownPillWidth = pillWidth;
    if (pillWidth > paneWidth / 2) isPaneNarrow.value = true;
  } else if (lastShownPillWidth <= paneWidth / 2) {
    isPaneNarrow.value = false;
  }
}

watch([paneEl, infoPillEl], ([paneNode, pillNode]) => {
  roPane?.disconnect();
  roPane = null;
  if (!paneNode || !pillNode) return;
  roPane = new ResizeObserver((entries) => {
    for (const e of entries) {
      if (e.target === paneNode) paneWidth = e.contentRect.width;
      else if (e.target === pillNode) pillWidth = e.contentRect.width;
    }
    updatePaneNarrow();
  });
  roPane.observe(paneNode);
  roPane.observe(pillNode);
});

const canDrag = computed(() => terminalStore.openTabs.length >= 1);
const pillTooltip = computed(() =>
  layoutStore.isTouchDevice ? "Tap for details" : "Drag to split  ·  Click for details",
);

// ピルの Dev Server / Changes・Branches / Close ボタンは、狭い画面幅
// （isMobile、MOBILE_BREAKPOINT_PX 基準）では普段は畳んでおき、ピルを
// 一度タップした時だけ展開する。展開中に他の操作（ピル外のクリック・
// キー入力）があったら閉じる。展開済みでもう一度タップした時だけ、
// 従来通り Files/Branches モーダルを開く。
// 広い画面幅ではスペースに余裕があるため、常に展開した状態にする
// （タップ操作を挟まず、クリックで直接モーダルを開く）。
const pillExpanded = ref(false);
const effectivePillExpanded = computed(() => !isMobile.value || pillExpanded.value);

// 閉じる際、Dev Server/Changes/Branches/Close 等の leave アニメーションが
// 終わってから「…」ボタンを出す。同時に出すと閉じきる前に開閉ピルが
// 割り込んで見えてしまうため。
const showMoreBtn = ref(true);
let moreBtnRevealTimer = null;

function collapsePill() {
  pillExpanded.value = false;
}

function onDocumentPointerDownForPill(e) {
  if (pillEl.value && pillEl.value.contains(e.target)) return;
  collapsePill();
}

watch(pillExpanded, (expanded) => {
  clearTimeout(moreBtnRevealTimer);
  if (expanded) {
    showMoreBtn.value = false;
    document.addEventListener("pointerdown", onDocumentPointerDownForPill, true);
    document.addEventListener("keydown", collapsePill, true);
  } else {
    moreBtnRevealTimer = setTimeout(() => {
      showMoreBtn.value = true;
    }, PILL_POP_LEAVE_MS);
    document.removeEventListener("pointerdown", onDocumentPointerDownForPill, true);
    document.removeEventListener("keydown", collapsePill, true);
  }
});

// 展開時、.pill-trailing（Dev Server/Changes/Branches/Close）の実測幅ぶんだけ
// pill-group を左へ寄せる。固定値だと実際のボタン構成によって画面端との間に
// 余白が残ってしまう（× ボタンが画面端に届かない）ため、常に実測値を使う。
const trailingWidth = ref(0);
let roTrailing = null;

watch(trailingEl, (el) => {
  roTrailing?.disconnect();
  roTrailing = null;
  if (!el) return;
  roTrailing = new ResizeObserver((entries) => {
    for (const e of entries) trailingWidth.value = e.contentRect.width;
  });
  roTrailing.observe(el);
});

// minus/close ボタンは常時表示のため、.pill-trailing は畳んだ状態でも
// 常に何かしら幅を持つ。よって right オフセットは常に実測幅を加算する。
const pillGroupRight = computed(() => `calc(var(--pill-base-right) + ${trailingWidth.value}px)`);

const tabId = computed(() => props.tab.id);
const { pillDragging, onPillMouseDown, onPillClick, onPillTouchStart, onPillTouchMove, onPillTouchEnd } = usePillDrag({
  tabId,
  canDrag,
  onTabClick: () => {
    if (props.tab.workspace) {
      workspaceStore.selectedWorkspace = props.tab.workspace;
      // ピルに ahead/behind（push/pullマーク）が出ている時は、その操作をする Branches ペインへ直接開く。
      // それ以外は Files ペインを開く。
      const hasPushPullMark = layoutStore.isSplitMode && (ahead.value > 0 || behind.value > 0);
      emit("git:openFileModal", { pane: hasPushPullMark ? "branch" : "files" });
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

// v-show で非表示（display:none）の間、pill-trailing の ResizeObserver は幅を
// 0 として報告する。タブ切り替えで再表示された直後に実測幅へ戻ると
// pillGroupRight が変化し、.pill-group の `transition: right` でスライドして
// 見えてしまう。タブ切り替え直後の 1 フレームだけこの transition を止める。
const suppressPillRightTransition = ref(!isActive.value);
watch(isActive, (active) => {
  if (!active) return;
  suppressPillRightTransition.value = true;
  // ResizeObserver のコールバックは requestAnimationFrame の後、フレーム終端で
  // 発火する。rAF を1回挟むだけだと trailingWidth の更新前に transition を
  // 再有効化してしまいアニメーションが見えるため、rAF を2回重ねて
  // ResizeObserver の発火・trailingWidth 反映を確実に待つ。
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressPillRightTransition.value = false;
      });
    });
  });
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
  startPreviewPolling();
});

watch(() => props.tab.workspace, () => fetchPreviewPorts());

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
  clearTimeout(moreBtnRevealTimer);
  stopPreviewPolling();
  roPane?.disconnect();
  roPane = null;
  roTrailing?.disconnect();
  roTrailing = null;
  document.removeEventListener("pointerdown", onDocumentPointerDownForPill, true);
  document.removeEventListener("keydown", collapsePill, true);
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
  /* 畳んでいる時の画面端からの余白。@media (min-width: 769px) で上書きされる。
     展開時は script 側で --pill-base-right に .pill-trailing の実測幅を
     足した calc() を right に設定し、× ボタンが常に画面端に届くようにする。 */
  --pill-base-right: 10px;
  right: var(--pill-base-right);
  transition: right 0.35s ease;
  /* Modal.vue の .modal-overlay(z-index:20) より下にして、設定ダイアログ表示中は
     このピルが上に乗って見えない・誤操作できてしまわないようにする。 */
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(80vw, 450px);
}

.pill-group.no-transition {
  transition: none;
}

/* Dev Server / Changes・Branches / Close ボタンは position:absolute で通常の
   flex フローから外し、.terminal-info-pill だけを唯一のフロー要素にする。
   こうするとボタンの増減で pill-group 自体の幅が変わっても、ピル本体の
   画面上の位置は一切動かない（ボタン群はピルの右に浮いて増減するだけ）。 */
.pill-trailing {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  left: 100%;
  margin-left: 4px;
}

.pill-pop-enter-active,
.pill-pop-leave-active {
  transition: transform 0.35s ease;
  overflow: hidden;
  white-space: nowrap;
}

.pill-pop-enter-from,
.pill-pop-leave-to {
  /* アニメーション開始位置がディスプレイの右端に一致するよう、画面幅基準にする。 */
  transform: translateX(100vw);
}

.pill-pop-move {
  transition: transform 0.35s ease;
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
  opacity: 1;
  font-size: 12px;
  line-height: 1.2;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: pointer;
  gap: 6px;
  /* flex-shrink:0（デフォルトの1のまま放置しない）: 展開ボタン群のポップ
     アニメーション中に、このピル自体の幅が兄弟の伸縮に引っ張られて揺れると、
     isPaneNarrow 用の ResizeObserver が連鎖的に発火し、CSS トランジションの
     layout 再計算に上乗せしてカクつく。ピル本体の幅は常に自分のコンテンツだけで
     決まるようにする。 */
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
}

.terminal-info-pill img {
  pointer-events: none;
  -webkit-user-drag: none;
}

/* GitActionBtn は WorkspaceStatusBar のツールバー用の見た目（アクセント色背景・
   高さ36px）を持つ。このピル内では他ボタン（numstat/branch/devserver）と
   同じ地の色・サイズ・フォントに統一し、push/pull は numstat-files や
   diff-num-plus と同じパターン（ニュートラルな地に数字だけ意味色）にする。 */
.pill-trailing :deep(.git-action-btn) {
  min-height: 28px;
  height: 28px;
  max-height: 28px;
  min-width: 28px;
  padding: 0 8px;
  gap: 4px;
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  border: 1px solid rgba(59, 66, 97, 0.5);
  font-size: 11px;
  font-weight: 600;
}

.pill-trailing :deep(.git-action-btn.pull-btn.has-count),
.pill-trailing :deep(.git-action-btn.push-btn.has-count) {
  background: rgba(26, 27, 38, 0.88);
  border: 1px solid rgba(59, 66, 97, 0.5);
}

.pill-devserver-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  flex-shrink: 0;
  padding: 0 8px;
  border: 1px solid rgba(59, 66, 97, 0.5);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.pill-devserver-text {
  font-size: 11px;
  white-space: nowrap;
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

.pill-branch-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 8px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 140px;
  border: 1px solid rgba(59, 66, 97, 0.5);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.pill-branch-btn .mdi {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.pill-branch-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.branch-abbr {
  color: var(--accent);
  font-weight: 500;
}

.terminal-info-pill.dragging {
  opacity: 0.5;
}

.pill-more-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  width: 28px;
  flex-shrink: 0;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(59, 66, 97, 0.5);
  background: rgba(26, 27, 38, 0.88);
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
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
    --pill-base-right: 20px;
  }

  .terminal-info-pill {
    cursor: grab;
  }

  .terminal-info-pill.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .pill-branch-btn {
    max-width: none;
  }
}

</style>
