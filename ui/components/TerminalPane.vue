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
          :aria-label="pillTooltip"
          role="button"
          tabindex="0"
          @mousedown="onPillMouseDown"
          @click="onPillClick"
          @keydown="onPillKeydown"
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
            <span v-if="!isPaneNarrow && !(isMobile && pillExpanded)" class="pill-workspace-label">{{ tab.workspace || tab.label || '' }}</span>
          </span>
        </div>
        <div
          class="pill-trailing"
          ref="trailingEl"
          :class="{ 'no-transition': suppressPillRightTransition }"
          :style="{ width: trailingTotalWidth + 'px' }"
        >
          <div class="pill-trailing-inner" ref="trailingInnerEl">
            <button
              v-if="(effectivePillExpanded || peekingKey === 'branch') && isGitRepo"
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
              v-if="(effectivePillExpanded || peekingKey === 'changes') && isGitRepo && isDirty"
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
              v-if="(effectivePillExpanded || peekingKey === 'pull') && isGitRepo && behind > 0"
              icon="pull"
              title="Pull"
              :count="behind"
              :running="isRunning(tab.workspace, 'pull')"
              btn-class="pull-btn has-count"
              @pointerdown.stop
              @action="doAction('pull')"
            />
            <GitActionBtn
              v-if="(effectivePillExpanded || peekingKey === 'push') && isGitRepo && !hasUpstream && hasRemoteBranch"
              icon="set-upstream"
              title="Set Upstream"
              :running="isRunning(tab.workspace, 'set-upstream')"
              btn-class="icon-only upstream-set-btn"
              @pointerdown.stop
              @action="doAction('set-upstream')"
            />
            <GitActionBtn
              v-if="(effectivePillExpanded || peekingKey === 'push') && isGitRepo && !hasUpstream && !hasRemoteBranch"
              icon="push-upstream"
              title="Push & Set Upstream"
              :count="ahead"
              :running="isRunning(tab.workspace, 'push-upstream')"
              btn-class="upstream-btn"
              @pointerdown.stop
              @action="doAction('push-upstream')"
            />
            <GitActionBtn
              v-if="(effectivePillExpanded || peekingKey === 'push') && isGitRepo && hasUpstream && ahead > 0"
              icon="push"
              title="Push"
              :count="ahead"
              :running="isRunning(tab.workspace, 'push')"
              btn-class="push-btn has-count"
              @pointerdown.stop
              @action="doAction('push')"
            />
            <button
              v-if="(effectivePillExpanded || peekingKey === 'devserver') && devServerEntry"
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
              v-if="(effectivePillExpanded || peekingKey === 'add') && !isGitRepo && tab.sessionId"
              type="button"
              class="pill-devserver-btn"
              aria-label="Add workspace"
              data-tooltip="Add this directory as a workspace"
              @pointerdown.stop
              @click.stop="registerCurrentDir"
            >
              <span class="mdi mdi-folder-plus-outline"></span>
              <span class="pill-devserver-text">Add</span>
            </button>
            <button
              v-if="isMobile"
              type="button"
              class="pill-more-btn"
              :class="{ expanded: pillExpanded }"
              :aria-label="pillExpanded ? 'Show less' : 'Show more'"
              :data-tooltip="pillExpanded ? 'Show less' : 'Show more'"
              @pointerdown.stop
              @click.stop="pillExpanded = !pillExpanded"
            >
              <span class="mdi mdi-dots-horizontal"></span>
            </button>
          </div>
          <!-- .pill-trailing-inner の flex フローから外し、.pill-trailing（外側）に
               対して right:0 で直接固定する。こうすると閉じるボタンの位置は
               width/right の transition タイミングに一切依存しなくなり、
               常に .pill-trailing の右端にピッタリ張り付き続ける。 -->
          <button
            v-if="layoutStore.isSplitMode"
            type="button"
            class="pill-close-btn pill-minus-btn pill-close-btn-fixed"
            aria-label="Remove from split"
            data-tooltip="Remove from split"
            @pointerdown.stop="onSplitCloseDown"
            @pointerup.stop="onSplitCloseUp"
            @click.stop
          >&minus;</button>
          <button
            v-if="!layoutStore.isSplitMode"
            type="button"
            class="pill-close-btn pill-tab-close-btn pill-close-btn-fixed"
            aria-label="Close tab"
            data-tooltip="Close tab"
            @pointerdown.stop="onTabCloseDown"
            @pointerup.stop="onTabCloseUp"
            @click.stop
          >&times;</button>
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
import { ACTIVE_FIT_DELAY_MS, PILL_MORE_PEEK_DURATION_MS } from "../utils/constants.js";
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
import { usePreviewPorts } from "../composables/usePreviewPorts.js";
import CircleKeyPad from "./CircleKeyPad.vue";
import StatusOverlay from "./StatusOverlay.vue";
import GitActionBtn from "./GitActionBtn.vue";
import { buildReconnectLabel } from "../utils/terminal-ws.js";
import { terminalSessionCwdPath } from "../utils/endpoints.js";
import { resolveBareTerminalFilesDetail, resolveRegisterCurrentDirAction } from "../utils/bare-terminal-actions.js";
import { trailingItemsSignature, findChangedTrailingItem } from "../utils/pill-peek.js";

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
// ペインごとの git 情報（変更行数・ahead/behind）をピルに直接出す。
const { isDirty, isGitRepo, hasUpstream, hasRemoteBranch, ahead, behind, changedFiles, insertions, deletions, branchParts } = useWorkspaceGitStatus(paneWorkspace, isMobile);
const { gitAction, isRunning } = useGitRemoteAction();

function doAction(action) {
  const wsName = props.tab.workspace;
  if (!wsName) return;
  gitAction(wsName, action, { branch: paneWorkspace.value?.branch || "" });
}

// Dev Server ボタンもピルに直接出す。ポーリング自体は usePreviewPorts に集約し、
// 開いている全タブで1本のタイマーを共有する。
const { ports: previewPorts, start: startPreviewPolling, stop: stopPreviewPolling, fetchPorts: fetchPreviewPorts } = usePreviewPorts();

const devServerEntry = computed(() => {
  // ワークスペース未紐付けのベアターミナルでは workspace===null 同士がマッチしてしまい、
  // 無関係な（他のベアターミナルから検出された）dev server が出てしまうため対象外にする。
  if (!props.tab.workspace) return null;
  return previewPorts.value.find((p) => p.workspace === props.tab.workspace && p.proxy_port) || null;
});

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

// git 未登録（ワークスペース未紐付け）のベアターミナルでは、cwd を都度取得して
// Files モーダル・ワークスペース登録に使う（常時ポーリングはせず必要時にのみ叩く）。
async function fetchCwd() {
  if (!props.tab.sessionId) return "";
  const { ok, data } = await apiGet(terminalSessionCwdPath(props.tab.sessionId));
  return ok ? (data?.cwd || "") : "";
}

async function openBareTerminalFiles() {
  const cwd = props.tab.sessionId ? await fetchCwd() : "";
  emit("git:openFileModal", resolveBareTerminalFilesDetail(props.tab.sessionId, cwd));
}

async function registerCurrentDir() {
  if (!props.tab.sessionId) return;
  const cwd = await fetchCwd();
  const action = resolveRegisterCurrentDirAction(cwd, workspaceStore.allWorkspaces);
  if (action.type === "openModal") {
    emit("workspace:openModal");
  } else if (action.type === "launch") {
    emit("terminal:launch", { workspace: action.workspace, icon: action.icon, iconColor: action.iconColor });
  } else {
    emit("workspace:openAdd", { initialPath: action.initialPath, attachSessionId: props.tab.sessionId, attachTabId: props.tab.id });
  }
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
const trailingInnerEl = ref(null);
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

function collapsePill() {
  pillExpanded.value = false;
}

function onDocumentPointerDownForPill(e) {
  if (pillEl.value && pillEl.value.contains(e.target)) return;
  collapsePill();
}

// Escape 以外のキーで閉じてしまうと、展開中のボタン群への Tab 移動や
// Enter/Space による操作がキー入力のたびに中断されてしまう。
function onDocumentKeydownForPill(e) {
  if (e.key === "Escape") collapsePill();
}

watch(pillExpanded, (expanded) => {
  if (expanded) {
    document.addEventListener("pointerdown", onDocumentPointerDownForPill, true);
    document.addEventListener("keydown", onDocumentKeydownForPill, true);
  } else {
    document.removeEventListener("pointerdown", onDocumentPointerDownForPill, true);
    document.removeEventListener("keydown", onDocumentKeydownForPill, true);
  }
});

// 畳んだ「...」ボタンの裏にある展開ボタン群（Branches/Changes/Pull/Push/Dev
// Server/Add workspace）の内容。値だけ見て良く、v-if の表示条件（isGitRepo 等）
// と揃えておく（peekingKey による一時表示の判定にも同じ key を使う）。
// ルックアライクは作らず「そのボタン自体」を一時的に表示するだけなので、
// ここでは変化検出用の最小限の値（key + 見た目に影響する text）だけ持てば良い。
const trailingPeekItems = computed(() => {
  const items = [];
  if (isGitRepo.value) {
    items.push({ key: "branch", text: `${branchParts.value.abbr || ""}${branchParts.value.rest || ""}` });
  }
  if (isGitRepo.value && isDirty.value) {
    items.push({ key: "changes", text: `${changedFiles.value}F +${insertions.value} -${deletions.value}` });
  }
  if (isGitRepo.value && behind.value > 0) {
    items.push({ key: "pull", text: `${behind.value}` });
  }
  if (isGitRepo.value && !hasUpstream.value && hasRemoteBranch.value) {
    items.push({ key: "push", text: "set-upstream" });
  } else if (isGitRepo.value && !hasUpstream.value && !hasRemoteBranch.value) {
    items.push({ key: "push", text: `push-upstream:${ahead.value}` });
  } else if (isGitRepo.value && hasUpstream.value && ahead.value > 0) {
    items.push({ key: "push", text: `push:${ahead.value}` });
  }
  if (devServerEntry.value) {
    items.push({ key: "devserver", text: "Server" });
  }
  if (!isGitRepo.value && props.tab.sessionId) {
    items.push({ key: "add", text: "Add" });
  }
  return items;
});

// 畳んだ「...」ボタンの裏の展開ボタン群のどれかが更新された時、そのボタン
// 自身を数秒だけ「...」の左に一時表示してから隠す（PILL_MORE_PEEK_DURATION_MS）。
// ルックアライクではなく実ボタンをそのまま v-if で出す（下記テンプレート、
// `|| peekingKey === '...'` 参照）ため、デザインは常に完全に一致する。
// 展開中（!isMobile または pillExpanded）は不要なので何もしない。
const peekingKey = ref(null);
let prevTrailingSignature = trailingItemsSignature(trailingPeekItems.value);
let pillMorePeekTimer = null;

watch(trailingPeekItems, (items) => {
  const nextSignature = trailingItemsSignature(items);
  if (isMobile.value && !pillExpanded.value) {
    const changed = findChangedTrailingItem(items, prevTrailingSignature);
    if (changed) {
      peekingKey.value = changed.key;
      if (pillMorePeekTimer) clearTimeout(pillMorePeekTimer);
      pillMorePeekTimer = setTimeout(() => {
        peekingKey.value = null;
        pillMorePeekTimer = null;
      }, PILL_MORE_PEEK_DURATION_MS);
    }
  }
  prevTrailingSignature = nextSignature;
}, { deep: true });

// 展開時・タブ非アクティブ化時は peek 表示を残さない。
watch(pillExpanded, (expanded) => {
  if (!expanded) return;
  peekingKey.value = null;
  if (pillMorePeekTimer) { clearTimeout(pillMorePeekTimer); pillMorePeekTimer = null; }
});

// 展開時、.pill-trailing-inner（Dev Server/Changes/Branches等、可変ボタン群）の
// 実測幅ぶんだけ pill-group を左へ寄せる。固定値だと実際のボタン構成によって
// 画面端との間に余白が残ってしまうため、常に実測値を使う。
// 計測は内側の pill-trailing-inner（常に content サイズ、閉じるボタンは含まない）
// で行い、外側の pill-trailing 自身は同じ trailingWidth を width として
// animate することで、「ボタンが即座にDOMへ出現 → 位置だけ遅れて追いつく」
// というズレ（右へ一瞬はみ出してから左へ戻る見え方）を無くし、閉じるボタンを
// 固定端に見せたまま内容が左向きに滑らかに開閉するようにする。
const trailingWidth = ref(0);
let roTrailing = null;

watch(trailingInnerEl, (el) => {
  roTrailing?.disconnect();
  roTrailing = null;
  if (!el) return;
  roTrailing = new ResizeObserver((entries) => {
    for (const e of entries) trailingWidth.value = e.contentRect.width;
  });
  roTrailing.observe(el);
});

// 閉じるボタン（.pill-close-btn-fixed）は pill-trailing-inner の flow から外し
// 幅28px + gap4px 分を .pill-trailing 自身の右端に固定表示するため、
// ResizeObserver が測る trailingWidth（可変ボタン群のみ）とは別にこの分を
// 常に加算する必要がある（閉じるボタンは常時表示のため定数扱いでよい）。
const PILL_CLOSE_BTN_RESERVED_PX = 32;
const trailingTotalWidth = computed(() => trailingWidth.value + PILL_CLOSE_BTN_RESERVED_PX);

// minus/close ボタンは常時表示のため、.pill-trailing は畳んだ状態でも
// 常に何かしら幅を持つ。よって right オフセットは常に実測幅を加算する。
const pillGroupRight = computed(() => `calc(var(--pill-base-right) + ${trailingTotalWidth.value}px)`);

function activatePill() {
  if (props.tab.workspace) {
    workspaceStore.selectedWorkspace = props.tab.workspace;
    // ピルに ahead/behind（push/pullマーク）が出ている時は、その操作をする Branches ペインへ直接開く。
    // それ以外は Jobs ペイン（既定）を開く。
    const hasPushPullMark = layoutStore.isSplitMode && isGitRepo.value && (ahead.value > 0 || behind.value > 0);
    emit("git:openFileModal", hasPushPullMark ? { pane: "branch" } : undefined);
  } else if (props.tab.sessionId) {
    // ワークスペース未紐付けのベアターミナルでは cwd を読んで Files を開く
    openBareTerminalFiles();
  } else {
    emit("workspace:openModal");
  }
}

// キーボードでの Enter/Space はマウス/タッチのドラッグ判定（pillMouseDownTime等）を
// 経由しないため、onPillClick とは別に activatePill を直接呼ぶ。
function onPillKeydown(e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  activatePill();
}

const tabId = computed(() => props.tab.id);
const { pillDragging, onPillMouseDown, onPillClick, onPillTouchStart, onPillTouchMove, onPillTouchEnd } = usePillDrag({
  tabId,
  canDrag,
  onTabClick: activatePill,
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
  if (infoPillEl.value) {
    // pillEl（.pill-group）ではなく infoPillEl（.terminal-info-pill）にスコープする。
    // pillEl には横スクロール可能な .pill-trailing も含まれており、そちらで
    // 始まったタッチも拾ってしまうと、ボタン群のスワイプスクロールより先に
    // ドラッグ判定（onPillTouchMove の e.preventDefault）が発火してスクロール
    // できなくなる。touchstart は元々 infoPillEl 側にしか付いていないため合わせる。
    infoPillEl.value.addEventListener("touchmove", onPillTouchMove, { passive: false });
    infoPillEl.value.addEventListener("touchend", onPillTouchEnd, { passive: false });
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
  stopPreviewPolling();
  if (pillMorePeekTimer) { clearTimeout(pillMorePeekTimer); pillMorePeekTimer = null; }
  roPane?.disconnect();
  roPane = null;
  roTrailing?.disconnect();
  roTrailing = null;
  document.removeEventListener("pointerdown", onDocumentPointerDownForPill, true);
  document.removeEventListener("keydown", onDocumentKeydownForPill, true);
  if (infoPillEl.value) {
    infoPillEl.value.removeEventListener("touchmove", onPillTouchMove);
    infoPillEl.value.removeEventListener("touchend", onPillTouchEnd);
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
/* 外側（trailingEl）は width を JS 実測値へ animate するクリップ用コンテナ。
   × ボタンを含む中身（.pill-trailing-inner）は常に content サイズで存在させ、
   外側の width だけを滑らかに広げ縮めることで、ボタンの出現/消失が位置の
   スライドと同期し、「一瞬右へはみ出してから戻る」ズレを起こさない。 */
.pill-trailing {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: 100%;
  margin-left: 4px;
  /* ボタン数が多い狭い画面（Pull/Push/Set Upstream/Dev Server等が同時に出る場合）で
     画面端からはみ出したボタンが見えない・押せなくなるのを防ぐ。可変個数を1行に
     収めるのではなく、上限幅を設けて横スクロールで到達可能にする。 */
  max-width: calc(100vw - 24px);
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
  scrollbar-width: none;
  transition: width 0.35s ease;
}

.pill-trailing.no-transition {
  transition: none;
}

.pill-trailing-inner {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* .pill-trailing-inner の flex フローから外し、.pill-trailing（外側）自身に
   対して固定する。width/right の transition タイミングに一切依存せず、
   常に .pill-trailing の右端にピッタリ張り付く。 */
.pill-close-btn-fixed {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
}

.pill-trailing::-webkit-scrollbar {
  display: none;
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

/* GitActionBtn のデフォルトはツールバー用の見た目（アクセント色背景・高さ36px）。
   このピル内では他ボタン（numstat/branch/devserver）と同じ地の色・サイズ・
   フォントに統一し、push/pull は numstat-files や diff-num-plus と同じ
   パターン（ニュートラルな地に数字だけ意味色）にする。 */
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
  transition: width 0.2s ease;
}

.pill-more-btn .mdi-dots-horizontal {
  transition: transform 0.2s ease;
}

/* 展開時は × と並ぶ「閉じる」トグルとして機能する。ドットを寝かせて開閉が
   分かるようにする（展開ボタン群は「...」の左側に生える）。 */
.pill-more-btn.expanded .mdi-dots-horizontal {
  transform: rotate(90deg);
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
