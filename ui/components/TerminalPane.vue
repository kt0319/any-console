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
    @contextmenu="onContextMenu"
    @mousedown="onMouseDown"
  >
    <StatusOverlay :visible="isReconnecting" :label="reconnectLabel" variant="warning" />
    <CircleKeyPad :state="circleKeypad.state" :keys="circleKeypadKeys" :specials="circleKeypadSpecials" />
    <div :id="'frame-' + tab.id" class="terminal-frame" ref="frameEl">
      <div
        class="pill-group"
        :class="{ 'pill-group-bottom': layoutStore.isPanelBottom }"
        ref="pillEl"
      >
        <Transition name="pill-fade" mode="out-in">
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
          :changed-files="changedFiles"
          :insertions="insertions"
          :deletions="deletions"
          :branch-name="paneWorkspace?.branch || ''"
          :ahead="ahead"
          :behind="behind"
          :push-count="branchPushCount"
          :pull-count="branchPullCount"
          :peek-duration-ms="peekDurationMs"
          @peek-click="onPeekClick"
        />
        <div v-else key="normal" class="pill-normal-group">
        <InfoPillRow
          :tab="tab"
          :max-width="trailingMaxWidth"
          :is-git-repo="isGitRepo"
          :is-dirty="isDirty"
          :ahead="ahead"
          :behind="behind"
          :has-pr="!!branchPR"
          :has-action="!!visibleBranchAction"
          :has-dev-server="!!devServerEntry"
          :dispatch-count="tabDispatchItems.length"
          :action-status-class="actionStatusClass"
          :action-status-icon="actionStatusIcon"
          :tooltips="tooltips"
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
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed, nextTick, toRef } from "vue";
import { useTerminal } from "../composables/useTerminal.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";
import { ACTIVE_FIT_DELAY_MS, PANE_PILL_TRAILING_RESERVED_PX } from "../utils/constants.js";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useTerminalPaste } from "../composables/useTerminalPaste.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import { useTerminalPaneGestures } from "../composables/useTerminalPaneGestures.js";
import { useCircleKeyPad } from "../composables/useCircleKeyPad.js";
import { useWorkspaceGitStatus } from "../composables/useWorkspaceGitStatus.js";
import { usePreviewPorts } from "../composables/usePreviewPorts.js";
import { useGithubPolling } from "../composables/useGithubPolling.js";
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import { useInfoPillActions } from "../composables/useInfoPillActions.js";
import { usePillPeek } from "../composables/usePillPeek.js";
import CircleKeyPad from "./CircleKeyPad.vue";
import StatusOverlay from "./StatusOverlay.vue";
import InfoPillRow from "./InfoPillRow.vue";
import PillPeek from "./PillPeek.vue";
import { buildReconnectLabel } from "../utils/terminal-ws.js";
import { findPRForBranch, findRunForBranch, isNoticeableRun, runStatusClass, runStatusIcon } from "../utils/github-runs.js";
import { dispatchWorkspaceLabel } from "../utils/dispatch-request.js";
import { buildInfoPillTooltips } from "../utils/info-pill-tooltips.js";
import { buildTrailingPeekItems } from "../utils/pill-peek.js";

const props = defineProps({
  tab: { type: Object, required: true },
  paneIndex: { type: Number, default: -1 },
});

const emits = defineEmits(["select-pane"]);

const tabRef = toRef(props, "tab");

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const infoPillConfig = useInfoPillConfigStore();
const { confirm } = useConfirm();

// tab は markRaw のため tab.workspace 単体の変更は追跡されない。
// terminalStore.tabWorkspaceVersion を読むことで、setTabWorkspace（Add で
// ベアターミナルにワークスペースを紐付けた時など）による変更をこの
// computed の再計算トリガーにする。
const paneWorkspace = computed(() => {
  terminalStore.tabWorkspaceVersion;
  return props.tab.workspace ? workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace) : undefined;
});
// ペインごとの git 情報（変更行数・ahead/behind）をピルに直接出す。
const { isDirty, isGitRepo, hasUpstream, ahead, behind, changedFiles, insertions, deletions } = useWorkspaceGitStatus(paneWorkspace);

// Dev Server ボタンもピルに直接出す。ポーリング自体は usePreviewPorts に集約し、
// 開いている全タブで1本のタイマーを共有する。ワークスペース未紐付けのベアターミナルは
// devServerEntry を絶対に持てない（下記参照）ため、それらのタブはポーリングに参加しない。
const { ports: previewPorts, start: startPreviewPolling, stop: stopPreviewPolling, fetchPorts: fetchPreviewPorts } = usePreviewPorts();
let previewPollingStarted = false;

function syncPreviewPolling() {
  const shouldPoll = !!props.tab.workspace;
  if (shouldPoll && !previewPollingStarted) {
    previewPollingStarted = true;
    startPreviewPolling();
  } else if (!shouldPoll && previewPollingStarted) {
    previewPollingStarted = false;
    stopPreviewPolling();
  }
}

const devServerEntry = computed(() => {
  // tab は markRaw のため tab.workspace 単体の変更は追跡されない（paneWorkspace と同じ理由）。
  terminalStore.tabWorkspaceVersion;
  // ワークスペース未紐付けのベアターミナルでは workspace===null 同士がマッチしてしまい、
  // 無関係な（他のベアターミナルから検出された）dev server が出てしまうため対象外にする。
  if (!props.tab.workspace) return null;
  return previewPorts.value.find((p) => p.workspace === props.tab.workspace && p.proxy_port) || null;
});

// GitHub PRピルは「現在のブランチに対応するPRがある時」だけ表示する
// （リポジトリ全体のPR一覧では無く、無関係なPRの存在では出さない）。
// 複数ペインでの重複フェッチはuseWorkspacePRs側でまとめている。
// PR/Actionsのポーリングは必ずペアで開始・停止するためuseGithubPollingに集約。
const { prsByWorkspace, runsByWorkspace, startGithubPolling, stopGithubPolling } = useGithubPolling();
const branchPR = computed(() => {
  if (!isGitRepo.value || !props.tab.workspace) return null;
  return findPRForBranch(prsByWorkspace.value[props.tab.workspace], paneWorkspace.value?.branch);
});

// GitHub Actionsピルも同様に「現在のブランチの最新run」がある時だけ表示する。
// 実行中→完了への遷移をピルに反映するため、表示中は定期的に再取得する
// （参照カウント式のポーリングはuseWorkspaceActions側に集約）。
const branchAction = computed(() => {
  if (!isGitRepo.value || !props.tab.workspace) return null;
  return findRunForBranch(runsByWorkspace.value[props.tab.workspace], paneWorkspace.value?.branch);
});

// failure以外で完了したrunはピル自体を表示しない（判定はisNoticeableRun参照）。
const visibleBranchAction = computed(() =>
  isNoticeableRun(branchAction.value) ? branchAction.value : null,
);

const githubWorkspaceKey = computed(() => (isGitRepo.value && paneWorkspace.value?.github_url) ? props.tab.workspace : null);

watch(
  githubWorkspaceKey,
  (workspace, prevWorkspace) => {
    if (prevWorkspace) stopGithubPolling(prevWorkspace);
    if (workspace) startGithubPolling(workspace);
  },
  { immediate: true },
);

const { queue: dispatchQueue } = useDispatchConfirm();
const tabDispatchItems = computed(() => {
  if (!props.tab.workspace) return [];
  return dispatchQueue.value.filter((item) => dispatchWorkspaceLabel(item.request) === props.tab.workspace);
});

// ピル・peekピルのクリック時の遷移（openPane(key)）はuseInfoPillActionsに集約。
const { openPane } = useInfoPillActions({
  tab: tabRef,
  isGitRepo,
  devServerEntry,
});

// peekピル（値が変化した時に一時表示する長いピル）自体をクリック/タップした時、
// 対応する通常ピルと同じ遷移先を開く。
function onPeekClick() {
  openPane(peekingKey.value);
}

const { ensureTerminalOpened, fitTerminal, sendResize, observeFrameResize, connectTerminalWs } = useTerminal();

const paneEl = ref(null);
const frameEl = ref(null);
const pillEl = ref(null);
let activeFitTimer = null;

// 分割モードでは .terminal-pane がビューポートよりずっと狭い。.pill-trailing の
// 横スクロール上限幅を 100vw 基準にすると、狭いペインではみ出した Branches/
// Changes 等の先頭側ボタンが .terminal-pane の overflow クリップで完全に
// 隠れ、スクロールしても届かなくなる。実測したペイン幅を基準にする。
const paneWidthRef = ref(0);
// 閉じるボタン・ワークスペースピル本体・余白ぶんを差し引いた残りをスクロール
// 領域の上限にする。マイナスにはしない。
const trailingMaxWidth = computed(() => Math.max(0, paneWidthRef.value - PANE_PILL_TRAILING_RESERVED_PX));
let roPane = null;

watch(paneEl, (paneNode) => {
  roPane?.disconnect();
  roPane = null;
  if (!paneNode) return;
  roPane = new ResizeObserver((entries) => {
    for (const e of entries) paneWidthRef.value = e.contentRect.width;
  });
  roPane.observe(paneNode);
});

// アイコンのみのボタンでも、PCでホバーした時にその時点の実際の値
// （ブランチ名・変更行数・Dev Serverの接続先）が data-tooltip で
// わかるようにする。文言の組み立てはinfo-pill-tooltips.js（純粋関数）。
const tooltips = computed(() => buildInfoPillTooltips({
  name: props.tab.workspace || props.tab.label || "",
  isGitRepo: isGitRepo.value,
  branch: paneWorkspace.value?.branch || "",
  ahead: ahead.value,
  behind: behind.value,
  hasUpstream: hasUpstream.value,
  changedFiles: changedFiles.value,
  insertions: insertions.value,
  deletions: deletions.value,
  lastCommitMessage: paneWorkspace.value?.last_commit_message,
  devServerEntry: devServerEntry.value,
  hostname: location.hostname,
  dispatchItems: tabDispatchItems.value,
  branchPR: branchPR.value,
  branchAction: branchAction.value,
}));

// 実行状況で色・アイコンを変える（判定はgithub-runs.jsのrunStatusClass/Icon参照）。
const actionStatusClass = computed(() => runStatusClass(branchAction.value));
const actionStatusIcon = computed(() => runStatusIcon());

// ピルの Dev Server / Changes・Branches / Files・Add・ワークスペース名は、
// PC・モバイル問わず常にアイコンのみ表示する。値が更新された時だけピル行を
// 丸ごと隠し、変化したキーの情報を載せた1本の長いピル（PillPeek.vue）に
// 数秒だけ差し替える（peekingKey、下記参照）。

// peek の変化検出対象（ワークスペース名/Branches/Changes/Pull/Push/
// Dev Server/Files/Add workspace）の内容。値だけ見て良く、v-if の
// 表示条件（isGitRepo 等）と揃えておく（peekingKey による一時表示の判定にも
// 同じ key を使う）。ここでは変化検出用の最小限の値（key + 見た目に影響する
// text）だけ持てば良い。組み立て自体はセッションサイドバー行と
// 共用するpill-peek.jsの純粋関数に集約する（branchをhistoryより前に置く
// 理由等の詳細コメントもそちら参照）。
// 省略表示形式（画面回転で変わりうる）をbranchのtextに使うと、回転しただけで
// 「ブランチが変わった」と誤検知してpeekが発火してしまうため、表示形式に
// 依存しない生のブランチ名を使う。actionsは成功で完了した瞬間もpeekで一度
// 知らせたいため、通常時は非表示になるsuccessも含めbranchAction
// （visibleBranchActionでフィルタする前の値）を変化検出に使う。
// peek関連（buildTrailingPeekItems / buildPeekText / buildPeekSignature）で使う
// フィールドはこの1つのcomputedに集約する（SessionSidebarRow.vueと同形。
// 2箇所に分けて組み立てると、フィールド追加時に片方だけ足すズレが起きるため）。
const peekFields = computed(() => ({
  workspaceLabel: props.tab.workspace || props.tab.label || "",
  isGitRepo: isGitRepo.value,
  hasSession: !!props.tab.sessionId,
  hasWorkspace: !!props.tab.workspace,
  isDirty: isDirty.value,
  changedFiles: changedFiles.value,
  insertions: insertions.value,
  deletions: deletions.value,
  branch: paneWorkspace.value?.branch || "",
  ahead: ahead.value,
  behind: behind.value,
  lastCommitMessage: paneWorkspace.value?.last_commit_message,
  branchPR: branchPR.value,
  branchAction: branchAction.value,
  devServerEntry: devServerEntry.value,
  dispatchItems: tabDispatchItems.value,
  dispatchTooltip: tooltips.value.dispatch,
}));

const trailingPeekItems = computed(() => buildTrailingPeekItems(peekFields.value, infoPillConfig));

// アイコン群のどれかの値が更新された時、ピル群全体を隠し、変化した対象の
// アイコン + 情報テキストだけを乗せた1本の長いピル（PillPeek.vue）を
// 数秒だけ表示する。変化検出・キュー・タイマーはusePillPeekに集約。
// peekピル表示用の派生値（アイコン・色・テキスト・シグネチャ）も
// usePillPeekが返す（SessionSidebarRowと共用）。
const {
  peekingKey,
  peekDurationMs,
  branchPushCount,
  branchPullCount,
  peekIconClass,
  peekColorClass,
  peekText,
  peekSignature,
} = usePillPeek({
  trailingPeekItems,
  paneWorkspace,
  workspaceKey: () => props.tab.workspace,
  prsByWorkspace,
  runsByWorkspace,
  devServerEntry,
  ahead,
  behind,
  peekFields,
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

const paneIndexRef = toRef(props, "paneIndex");
const circleKeypad = useCircleKeyPad();
const circleKeypadKeys = circleKeypad.keys;
const circleKeypadSpecials = circleKeypad.specials;
const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu, onMouseDown } = useTerminalPaneGestures({
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
  if (frameEl.value) {
    frameEl.value.addEventListener("wheel", onWheel, { passive: false, capture: true });
  }
  syncPreviewPolling();
});

// tab は markRaw のため tab.workspace 単体の変更は追跡されない。
// tabWorkspaceVersion（setTabWorkspace が進める）を watch し、実際の
// 値の読み取りは syncPreviewPolling 内で props.tab.workspace を直接見る。
watch(() => terminalStore.tabWorkspaceVersion, () => {
  syncPreviewPolling();
  if (previewPollingStarted) fetchPreviewPorts();
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
  if (previewPollingStarted) stopPreviewPolling();
  if (githubWorkspaceKey.value) stopGithubPolling(githubWorkspaceKey.value);
  roPane?.disconnect();
  roPane = null;
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

@media (pointer: coarse) {
  .terminal-frame :deep(.xterm textarea) {
    pointer-events: none !important;
  }
}
</style>
