<template>
  <div
    class="terminal-pane"
    :class="{ active: isActive, 'terminal-pane-drop-active': isImageDropActive }"
    ref="paneEl"
    @pointerdown.capture="onPointerDown"
    @touchstart="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchCancel"
    @contextmenu="onContextMenu"
    @mousedown="onMouseDown"
    @dragenter="onImageDragEnter"
    @dragover="onImageDragOver"
    @dragleave="onImageDragLeave"
    @drop="onImageDrop"
  >
    <StatusOverlay :visible="isReconnecting" :label="reconnectLabel" variant="warning" />
    <CircleKeypad :state="circleKeypad.state" :keys="circleKeypadKeys" :specials="circleKeypadSpecials" />
    <!-- barモードは各ペインの上部/下部にフローの一部として帯を固定するため、
         絶対配置基準である.terminal-frameの外（兄弟）に置き、bar-bottomは
         order:1（下記CSS）で.terminal-frameの後ろへ回す。floatモードでも
         .pill-groupはposition:absoluteのままなので、.terminal-frame(inset:0)
         基準から.terminal-pane(position:relative)基準に変わるだけで見た目は
         変わらない。 -->
    <div
      v-if="layoutStore.infoPillDisplayMode !== 'off'"
      class="pill-group"
      :class="{
        'pill-group-bottom': layoutStore.infoPillDisplayMode === 'float-bottom',
        'pill-group-bar': layoutStore.isInfoPillBar,
        'pill-group-bar-bottom': layoutStore.infoPillDisplayMode === 'bar-bottom',
      }"
      ref="pillEl"
    >
        <SessionPillBar v-if="layoutStore.isInfoPillBar" :item="barItem" :tab="tab" :peek="peek" @open="openPane">
          <template #actions>
            <button
              v-if="layoutStore.isSplitMode"
              type="button"
              class="pill-close-btn pill-minus-btn"
              aria-label="Remove from split"
              data-tooltip="Remove from split"
              @pointerdown.stop="onSplitCloseDown"
              @pointerup.stop="onSplitCloseUp"
              @click.stop
            ><span class="mdi mdi-minus"></span></button>
            <button
              v-else
              type="button"
              class="pill-close-btn pill-tab-close-btn"
              aria-label="Close tab"
              data-tooltip="Close tab"
              @pointerdown.stop="onTabCloseDown"
              @pointerup.stop="onTabCloseUp"
              @click.stop
            ><span class="mdi mdi-close"></span></button>
          </template>
        </SessionPillBar>
        <Transition v-else name="pill-fade" mode="out-in">
        <PillPeek
          v-if="peekingKey"
          :key="peekingKey"
          :peeking-key="peekingKey"
          :color-class="peekColorClass"
          :icon-class="peekIconClass"
          :text="peekText"
          :signature="peekSignature"
          :tab="tab"
          :max-width="trailingMaxWidth"
          :insertions="pill.insertions"
          :deletions="pill.deletions"
          :status-counts="pill.statusCounts"
          :branch-name="pill.branch"
          :ahead="pill.ahead"
          :behind="pill.behind"
          :push-count="branchPushCount"
          :pull-count="branchPullCount"
          :remote-result="branchRemoteResult"
          :action-name="peekActionName"
          :action-status-text="peekActionStatusText"
          :peek-duration-ms="peekDurationMs"
          @peek-click="onPeekClick"
        />
        <div v-else key="normal" class="pill-normal-group">
        <InfoPillRow
          :tab="tab"
          :max-width="pillRowMaxWidth"
          v-bind="buildInfoPillRowProps(pill, !!paneWorkspace?.worktree)"
          @open="openPane"
        />
        <button
          v-if="layoutStore.isSplitMode"
          type="button"
          class="pill-close-btn pill-minus-btn"
          aria-label="Remove from split"
          data-tooltip="Remove from split"
          @pointerdown.stop="onSplitCloseDown"
          @pointerup.stop="onSplitCloseUp"
          @click.stop
        ><span class="mdi mdi-minus"></span></button>
        <button
          v-if="!layoutStore.isSplitMode"
          type="button"
          class="pill-close-btn pill-tab-close-btn"
          aria-label="Close tab"
          data-tooltip="Close tab"
          @pointerdown.stop="onTabCloseDown"
          @pointerup.stop="onTabCloseUp"
          @click.stop
        ><span class="mdi mdi-close"></span></button>
        </div>
        </Transition>
    </div>
    <div
      :id="'frame-' + tab.id"
      class="terminal-frame"
      :class="{ 'terminal-frame-bar-mode': layoutStore.isInfoPillBar }"
      ref="frameEl"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick, toRef, type PropType, type Ref } from "vue";
import type { Terminal } from "@xterm/xterm";
import { useTerminal } from "../composables/useTerminal.ts";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useTerminalSettingsStore } from "../stores/terminal-settings.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { ACTIVE_FIT_DELAY_MS, PANE_PILL_TRAILING_RESERVED_PX } from "../utils/constants.ts";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.ts";
import { useTerminalPaste } from "../composables/useTerminalPaste.ts";
import { useTerminalImageDrop } from "../composables/useTerminalImageDrop.ts";
import { useTabClose } from "../composables/useTabClose.ts";
import { useTerminalPaneGestures } from "../composables/useTerminalPaneGestures.ts";
import { useCircleKeypad } from "../composables/useCircleKeypad.ts";
import { useElementMaxWidth } from "../composables/useElementMaxWidth.ts";
import { useTerminalPanePills } from "../composables/useTerminalPanePills.ts";
import CircleKeypad from "./CircleKeypad.vue";
import StatusOverlay from "./StatusOverlay.vue";
import InfoPillRow from "./InfoPillRow.vue";
import PillPeek from "./PillPeek.vue";
import SessionPillBar from "./SessionPillBar.vue";
import { buildReconnectLabel } from "../utils/terminal-ws.ts";
import { buildInfoPillRowProps } from "../utils/pill-fields.ts";
import { getLastPointerType } from "../utils/pointer-type.ts";

const props = defineProps({
  tab: { type: Object as PropType<TerminalTab>, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const tabRef = toRef(props, "tab");

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const { confirmAndCloseTab } = useTabClose();

// tab は markRaw のため tab.workspace 単体の変更は追跡されない。
// terminalStore.tabWorkspaceVersion を読むことで、setTabWorkspace（Add で
// ベアターミナルにワークスペースを紐付けた時など）による変更をこの
// computed の再計算トリガーにする。
const paneWorkspace = computed(() => {
  terminalStore.tabWorkspaceVersion;
  return props.tab.workspace ? workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace) : undefined;
});

const {
  pill,
  peek,
  barItem,
  openPane,
  onPeekClick,
  syncWorkspacePolling,
  refreshWorkspacePolling,
  stopWorkspacePolling,
} = useTerminalPanePills(tabRef, paneWorkspace);

const { ensureTerminalOpened, fitTerminal, sendResize, observeFrameResize, connectTerminalWs } = useTerminal();

const paneEl = ref<HTMLElement | null>(null);
const frameEl = ref<HTMLElement | null>(null);
const pillEl = ref<HTMLElement | null>(null);
let activeFitTimer: ReturnType<typeof setTimeout> | null = null;

// 分割モードでは.terminal-paneがビューポートよりずっと狭い。.pill-trailingの横スクロール
// 上限幅を100vw基準にすると、はみ出したBranches/Changes等のボタンがoverflowクリップで隠れて
// 届かなくなるため、実測したペイン幅から閉じるボタン等を差し引いた残りを上限にする。
// ピーク（長い1行テキスト）は画面幅の半分で止めるが、アイコンのピル行はその上限を
// かけず、ペイン幅いっぱいまで全部並べる。
const { maxWidth: trailingMaxWidth, availableWidth: pillRowMaxWidth } = useElementMaxWidth(paneEl, PANE_PILL_TRAILING_RESERVED_PX);

const {
  peekingKey,
  peekDurationMs,
  branchPushCount,
  branchPullCount,
  branchRemoteResult,
  peekIconClass,
  peekColorClass,
  peekText,
  peekSignature,
  peekActionName,
  peekActionStatusText,
} = peek;

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
  buildReconnectLabel(terminalStore.tabFlags[props.tab.id]?.reconnectReason as string | undefined),
);

const paneIndexRef = toRef(props, "paneIndex");
const circleKeypad = useCircleKeypad();
const circleKeypadKeys = circleKeypad.keys;
const circleKeypadSpecials = circleKeypad.specials;
const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu, onMouseDown } = useTerminalPaneGestures({
  tab: tabRef as Ref<TerminalTab | null | undefined>,
  pillEl,
  circleKeypad,
  isActive,
  paneIndex: paneIndexRef,
  onSelectPane: (idx) => emits("select-pane", idx),
});
useTerminalPaste({ tab: tabRef, isActive });
const {
  isDropActive: isImageDropActive,
  onDragEnter: onImageDragEnter,
  onDragOver: onImageDragOver,
  onDragLeave: onImageDragLeave,
  onDrop: onImageDrop,
} = useTerminalImageDrop({ tab: tabRef });

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

function onSplitCloseDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onSplitCloseUp() {
  layoutStore.replaceTabWithEmpty(props.tab.id);
}

let tabClosePending = false;

function onTabCloseDown(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  tabClosePending = true;
}

async function onTabCloseUp() {
  if (!tabClosePending) return;
  tabClosePending = false;
  await confirmAndCloseTab(props.tab);
}

function onPointerDown(e: PointerEvent) {
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

function onWheel(e: WheelEvent) {
  const term = props.tab?.term;
  if (!term) return;
  e.preventDefault();
}

// term.open() 後、タップ（touch）ではOSキーボードを開かせず、クリック
// （mouse/pen等）では通常通りフォーカスを許可する。アプリ全体で最後に観測した
// pointerType（getLastPointerType）で判定する。ターミナル要素自体へのpointerdown
// だけを見ると、確認ダイアログをタップで閉じた直後のタブ切替えのように、
// ターミナル要素自身は何もイベントを受けていないfocus()呼び出しを判定できないため。
function applyFocusGuard(term: Terminal | null | undefined) {
  const textarea = term?.textarea;
  if (!term || !textarea) return;
  textarea.tabIndex = -1;
  textarea.addEventListener("focus", () => {
    if (getLastPointerType() === "touch") textarea.blur();
  });
}

onMounted(() => {
  if (frameEl.value) {
    const fs = useTerminalSettingsStore().terminalSettings?.fontSize || 12;
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
  if (frameEl.value) {
    frameEl.value.addEventListener("wheel", onWheel, { passive: false, capture: true });
  }
  syncWorkspacePolling();
});

// tab は markRaw のため tab.workspace 単体の変更は追跡されない。
// tabWorkspaceVersion（setTabWorkspace が進める）を watch し、実際の
// 値の読み取りは syncWorkspacePolling 内で props.tab.workspace を直接見る。
watch(() => terminalStore.tabWorkspaceVersion, () => {
  syncWorkspacePolling();
  if (!props.tab.workspace) return;
  refreshWorkspacePolling();
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
  stopWorkspacePolling();
  if (frameEl.value) {
    frameEl.value.removeEventListener("wheel", onWheel, { capture: true });
  }
});

defineExpose({
  tabId: props.tab.id,
  fit(opts?: { force?: boolean, scrollToBottom?: boolean }) {
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

.terminal-pane-drop-active::after {
  content: "Drop image to paste";
  position: absolute;
  inset: 8px;
  border: 2px dashed var(--accent);
  border-radius: var(--radius);
  background: rgba(76, 175, 80, 0.08);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 16px;
  pointer-events: none;
  z-index: 5;
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

/* Info Pills（bar表示）が.terminal-frameの前に帯として実要素で並ぶため、
   絶対配置で親全体を覆う代わりに.terminal-pane（flex-direction:column）の
   残り高さを占めるフローアイテムにする。ResizeObserver（observeFrameResize）
   がこのサイズ変化を検知してxtermを自動fitする。 */
.terminal-frame.terminal-frame-bar-mode {
  position: relative;
  inset: auto;
  flex: 1;
  min-height: 0;
  height: auto;
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

@media (pointer: coarse) {
  .terminal-frame :deep(.xterm textarea) {
    pointer-events: none !important;
  }
}
</style>
