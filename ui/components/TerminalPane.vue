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
      >
        <div
          class="pill-trailing"
          ref="trailingEl"
          :class="{ 'no-transition': suppressTrailingWidthTransition }"
          :style="{ width: trailingWidth + 'px', maxWidth: trailingMaxWidth + 'px' }"
        >
          <div class="pill-trailing-inner" ref="trailingInnerEl">
              <button
                v-if="isGitRepo && isDirty && infoPillConfig.changes"
                type="button"
                class="pill-numstat-btn"
                :aria-label="changesTooltip"
                :data-tooltip="changesTooltip"
                @pointerdown.stop
                @click.stop="openChanges"
              >
                <span class="mdi mdi-file-document-edit-outline"></span>
                <span class="numstat-inline pill-label-hover" :class="{ peeking: peekingKey === 'changes' }">
                  <span v-if="changedFiles > 0" class="numstat-files">{{ changedFiles }}F</span>
                  <span class="diff-num-plus">+{{ insertions }}</span>
                  <span class="diff-num-del">-{{ deletions }}</span>
                </span>
              </button>
              <GitActionBtn
                v-if="isGitRepo && behind > 0 && infoPillConfig.pull"
                icon="pull"
                title="Pull"
                :count="behind"
                :running="isRunning(tab.workspace, 'pull')"
                btn-class="pull-btn has-count"
                @pointerdown.stop
                @action="doAction('pull')"
              />
              <GitActionBtn
                v-if="isGitRepo && !hasUpstream && hasRemoteBranch && infoPillConfig.push"
                icon="set-upstream"
                title="Set Upstream"
                :running="isRunning(tab.workspace, 'set-upstream')"
                btn-class="icon-only upstream-set-btn"
                @pointerdown.stop
                @action="doAction('set-upstream')"
              />
              <GitActionBtn
                v-if="isGitRepo && !hasUpstream && !hasRemoteBranch && infoPillConfig.push"
                icon="push-upstream"
                title="Push & Set Upstream"
                :count="ahead"
                :running="isRunning(tab.workspace, 'push-upstream')"
                btn-class="upstream-btn"
                @pointerdown.stop
                @action="doAction('push-upstream')"
              />
              <GitActionBtn
                v-if="isGitRepo && hasUpstream && ahead > 0 && infoPillConfig.push"
                icon="push"
                title="Push"
                :count="ahead"
                :running="isRunning(tab.workspace, 'push')"
                btn-class="push-btn has-count"
                @pointerdown.stop
                @action="doAction('push')"
              />
              <button
                v-if="isGitRepo && infoPillConfig.branch"
                type="button"
                class="pill-branch-btn"
                :aria-label="branchTooltip"
                :data-tooltip="branchTooltip"
                @pointerdown.stop
                @click.stop="openBranch"
              >
                <span class="mdi mdi-source-branch"></span>
                <span class="pill-branch-text pill-label-hover" :class="{ peeking: peekingKey === 'branch' }"><span v-if="branchParts.abbr" class="branch-abbr">{{ branchParts.abbr }}</span>{{ branchParts.rest }}</span>
              </button>
              <button
                v-if="isGitRepo && infoPillConfig.history"
                type="button"
                class="pill-devserver-btn"
                aria-label="History"
                data-tooltip="History"
                @pointerdown.stop
                @click.stop="openHistory"
              >
                <span class="mdi mdi-history"></span>
                <span class="pill-devserver-text pill-label-hover" :class="{ peeking: peekingKey === 'history' }">History</span>
              </button>
              <button
                v-if="devServerEntry && infoPillConfig.devserver"
                type="button"
                class="pill-devserver-btn"
                :aria-label="devServerTooltip"
                :data-tooltip="devServerTooltip"
                @pointerdown.stop
                @click.stop="openDevServer"
              >
                <span class="mdi mdi-server"></span>
                <span class="pill-devserver-text pill-label-hover" :class="{ peeking: peekingKey === 'devserver' }">Server</span>
              </button>
              <button
                v-if="(isGitRepo || tab.sessionId) && infoPillConfig.files"
                type="button"
                class="pill-devserver-btn"
                aria-label="Files"
                :data-tooltip="isGitRepo ? 'Browse files' : 'Browse files in this terminal\'s directory'"
                @pointerdown.stop
                @click.stop="openFiles"
              >
                <span class="mdi mdi-folder-outline"></span>
                <span class="pill-devserver-text pill-label-hover" :class="{ peeking: peekingKey === 'files' }">Files</span>
              </button>
              <button
                v-if="!isGitRepo && tab.sessionId && infoPillConfig.add"
                type="button"
                class="pill-devserver-btn"
                aria-label="Add or open this directory as a workspace"
                data-tooltip="Add or open this directory as a workspace"
                @pointerdown.stop
                @click.stop="registerCurrentDir"
              >
                <span class="mdi mdi-folder-plus-outline"></span>
                <span class="pill-devserver-text pill-label-hover" :class="{ peeking: peekingKey === 'add' }">Add</span>
              </button>
            </div>
          </div>
          <!-- ワークスペースピル本体・閉じるボタンは .pill-trailing（overflow-x:
               auto でクリップされ得る幅アニメーション用コンテナ）の外、
               .pill-group の直接の flex子として常時表示する。こうすると
               アニメーション中や多ボタン時の横スクロール領域とは無関係になり、
               クリップされて欠けることが無い。並び順は「展開ボタン群→
               ワークスペースピル→閉じるボタン」で固定し、ワークスペースピルは
               常に右端（閉じるボタンの左隣）に来る。
               .pill-group 自体は right が固定値（JS計算なし）の flex コンテナ
               なので、常にブラウザ標準のflexレイアウトで画面内に正しく収まる
               （オフセット計算のズレで見切れる/崩れることが無い）。 -->
          <div
            class="terminal-info-pill"
            ref="infoPillEl"
            :class="{ 'tab-activity': tab._activity, 'pill-working': agentState === 'working', dragging: pillDragging }"
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
                <span v-html="renderIconStr(tab.wsIcon.name, tab.wsIcon.color, 16)"></span>
                <span v-if="isDirty" class="pill-dirty-badge" aria-label="uncommitted changes"></span>
              </span>
              <span v-if="tab.icon" class="pill-icon-slot pill-icon-badge-wrap">
                <span v-html="renderIconStr(tab.icon.name, tab.icon.color, 16)"></span>
                <span v-if="!tab.wsIcon && isDirty" class="pill-dirty-badge" aria-label="uncommitted changes"></span>
              </span>
              <span v-if="infoPillConfig.workspace" class="pill-workspace-label pill-label-hover" :class="{ peeking: peekingKey === 'workspace' }">{{ tab.workspace || tab.label || '' }}</span>
            </span>
          </div>
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
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";
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
const infoPillConfig = useInfoPillConfigStore();
const { confirm } = useConfirm();
const { isMobile } = useIsMobile();
const { apiGet } = useApi();

// tab は markRaw のため tab.workspace 単体の変更は追跡されない。
// terminalStore.tabWorkspaceVersion を読むことで、setTabWorkspace（Add で
// ベアターミナルにワークスペースを紐付けた時など）による変更をこの
// computed の再計算トリガーにする。
const paneWorkspace = computed(() => {
  terminalStore.tabWorkspaceVersion;
  return props.tab.workspace ? workspaceStore.allWorkspaces.find((w) => w.name === props.tab.workspace) : undefined;
});
// ペインごとの git 情報（変更行数・ahead/behind）をピルに直接出す。
const { isDirty, isGitRepo, hasUpstream, hasRemoteBranch, ahead, behind, changedFiles, insertions, deletions, branchParts } = useWorkspaceGitStatus(paneWorkspace, isMobile);
const { gitAction, isRunning } = useGitRemoteAction();

function doAction(action) {
  const wsName = props.tab.workspace;
  if (!wsName) return;
  gitAction(wsName, action, { branch: paneWorkspace.value?.branch || "" });
}

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

// 非Gitワークスペースに紐づいたターミナルでcdして未登録ディレクトリへ移動した
// 場合や、ワークスペース未紐付けのベアターミナルの場合、Files はワークスペース
// パスではなくセッションの実際のcwdを起点に開く（廃止済みWorkspaceStatusBarの
// isPlainTerminal時の挙動を踏襲）。
async function openBareTerminalFiles() {
  const cwd = props.tab.sessionId ? await fetchCwd() : "";
  emit("git:openFileModal", resolveBareTerminalFilesDetail(props.tab.sessionId, cwd));
}

// Gitワークスペースはワークスペース名から直接Filesペインを開く。
// 非Git（ベアターミナル・非Git登録ワークスペース）はcwd起点のopenBareTerminalFilesへ。
function openFiles() {
  if (isGitRepo.value && props.tab.workspace) {
    workspaceStore.selectedWorkspace = props.tab.workspace;
    emit("git:openFileModal", { pane: "files" });
  } else {
    openBareTerminalFiles();
  }
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

// 「Add」ボタンのラベル・アイコンは固定表示にする。実際にAdd/Openの
// どちらとして動くかはクリック時にregisterCurrentDirがcwdを取得して
// その場で判定する。
function openBranch() {
  if (!props.tab.workspace) return;
  workspaceStore.selectedWorkspace = props.tab.workspace;
  emit("git:openFileModal", { pane: "branch" });
}

function openHistory() {
  if (!props.tab.workspace) return;
  workspaceStore.selectedWorkspace = props.tab.workspace;
  emit("git:openFileModal", { pane: "history" });
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

// 分割モードでは .terminal-pane がビューポートよりずっと狭い。.pill-trailing の
// 横スクロール上限幅を 100vw 基準にすると、狭いペインではみ出した Branches/
// Changes 等の先頭側ボタンが .terminal-pane の overflow クリップで完全に
// 隠れ、スクロールしても届かなくなる。実測したペイン幅を基準にする。
const paneWidthRef = ref(0);
// 閉じるボタン・ワークスペースピル本体・余白ぶんを差し引いた残りをスクロール
// 領域の上限にする。マイナスにはしない。
const trailingMaxWidth = computed(() => Math.max(0, paneWidthRef.value - 80));
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

const canDrag = computed(() => terminalStore.openTabs.length >= 1);
const pillTooltip = computed(() => {
  const name = props.tab.workspace || props.tab.label || "";
  const action = layoutStore.isTouchDevice ? "Tap for details" : "Drag to split  ·  Click for details";
  return name ? `${name}  ·  ${action}` : action;
});

// アイコンのみのボタンでも、PCでホバーした時にその時点の実際の値
// （ブランチ名・変更行数・Dev Serverの接続先）が data-tooltip で
// わかるようにする。固定の説明文言だけだと、展開しないと現在値を
// 確認できないため。
const branchTooltip = computed(() => `Branches: ${paneWorkspace.value?.branch || ""}`);
const changesTooltip = computed(() =>
  `Changes: ${changedFiles.value}F +${insertions.value} -${deletions.value}`,
);
const devServerTooltip = computed(() => {
  const p = devServerEntry.value;
  if (!p) return "Dev Server";
  return `Dev Server: ${p.scheme || "http"}://${location.hostname}:${p.proxy_port}`;
});

// ピルの Dev Server / Changes・Branches / Files・Add・ワークスペース名は、
// PC・モバイル問わず常にアイコンのみ表示する。ラベル文字列は普段は隠し、
// 値が更新された時だけそのボタン自身（ルックアライクではなく実ボタン）を
// 数秒だけラベル込みで表示する（peekingKey、下記参照）。

// 畳んだアイコン群の裏にあるラベル（ワークスペース名/Branches/Changes/Pull/
// Push/Dev Server/Files/Add workspace）の内容。値だけ見て良く、v-if の
// 表示条件（isGitRepo 等）と揃えておく（peekingKey による一時表示の判定にも
// 同じ key を使う）。ルックアライクは作らず「そのボタン自体」のラベル部分を
// 一時的に表示するだけなので、ここでは変化検出用の最小限の値（key + 見た目に
// 影響する text）だけ持てば良い。
const trailingPeekItems = computed(() => {
  const items = [];
  items.push({ key: "workspace", text: props.tab.workspace || props.tab.label || "" });
  if (isGitRepo.value) {
    // branchParts は isMobile（画面回転で変わりうる）に応じて省略表示形式が
    // 変わるため、そのまま text にすると回転しただけで「ブランチが変わった」
    // と誤検知して peek が発火してしまう。表示形式に依存しない生のブランチ名を使う。
    items.push({ key: "branch", text: paneWorkspace.value?.branch || "" });
    items.push({ key: "history", text: "History" });
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
  if (isGitRepo.value || props.tab.sessionId) {
    items.push({ key: "files", text: "Files" });
  }
  if (!isGitRepo.value && props.tab.sessionId) {
    items.push({ key: "add", text: "Add" });
  }
  return items;
});

// アイコン群のどれかのラベルが更新された時、そのボタンのラベル部分を
// 数秒だけ表示してから隠す（PC・モバイル共通、PILL_MORE_PEEK_DURATION_MS）。
const peekingKey = ref(null);
let prevTrailingSignature = trailingItemsSignature(trailingPeekItems.value);
let pillMorePeekTimer = null;
// paneWorkspace は workspaceStore.allWorkspaces（非同期フェッチ）に依存するため、
// マウント直後は未解決（undefined）で isGitRepo 等が一時的に false になり得る。
// このタイミングで prevTrailingSignature を確定させると、ワークスペース情報が
// 届いた瞬間に「branch が新規に現れた」と誤検知して、畳んだ状態でも
// Branches ボタンが一瞬 peek 表示されてしまう。ワークスペースが一度でも
// 解決するまでは変化検出を行わず、解決した最初の1回はベースラインの
// 更新だけ行って peek はスキップする。
let workspaceEverResolved = paneWorkspace.value !== undefined;

watch(trailingPeekItems, (items) => {
  const nextSignature = trailingItemsSignature(items);
  const justResolved = !workspaceEverResolved && paneWorkspace.value !== undefined;
  if (justResolved) workspaceEverResolved = true;
  if (workspaceEverResolved && !justResolved) {
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

// .pill-trailing（Dev Server/Changes/Branches等、可変ボタン群のクリップ用
// コンテナ）の width を、中身の実測幅（.pill-trailing-inner の content サイズ）
// へ滑らかに animate する。.pill-group 自体は right が固定値の flex コンテナ
// なので、この width が変化するだけで pill-group 全体が自然に左右へ伸縮し、
// JS でのオフセット計算は一切不要（閉じるボタンの位置ズレ・見切れの原因に
// なっていた計算をまるごと廃止した）。
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

// ワークスペースピル本体のタップ/クリックは Jobs/Files ペインを直接開く。
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
// 0 として報告する。タブ切り替えで再表示された直後に実測幅へ戻ると、
// .pill-trailing の `transition: width` でスライドして見えてしまう。
// タブ切り替え直後の 1 フレームだけこの transition を止める。
const suppressTrailingWidthTransition = ref(!isActive.value);
watch(isActive, (active) => {
  if (!active) return;
  suppressTrailingWidthTransition.value = true;
  // ResizeObserver のコールバックは requestAnimationFrame の後、フレーム終端で
  // 発火する。rAF を1回挟むだけだと trailingWidth の更新前に transition を
  // 再有効化してしまいアニメーションが見えるため、rAF を2回重ねて
  // ResizeObserver の発火・trailingWidth 反映を確実に待つ。
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressTrailingWidthTransition.value = false;
      });
    });
  });
});

// peek表示（値が変化した時の一時ラベル表示）で1つのボタンの幅が広がると、
// .pill-trailing の `transition: width` が同じ行の他の全ボタン（例:
// Branches）まで一緒にスライドさせてしまい、無関係なピルまで動いたように
// 見える。peekingKey が変化した瞬間だけこの transition を止める（ボタン
// 自体の出現/消失アニメーションは peekingKey を伴わないため影響しない）。
watch(peekingKey, () => {
  suppressTrailingWidthTransition.value = true;
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressTrailingWidthTransition.value = false;
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
  if (pillMorePeekTimer) { clearTimeout(pillMorePeekTimer); pillMorePeekTimer = null; }
  roPane?.disconnect();
  roPane = null;
  roTrailing?.disconnect();
  roTrailing = null;
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

/* right は固定値（JS計算なし）。.pill-group 自体を flex コンテナにして
   terminal-info-pill / pill-trailing（幅アニメーション）/ 閉じるボタンを
   直接の flex子として並べることで、閉じるボタンは常にブラウザ標準の
   flexレイアウトで右端に位置する。ボタン数が増減して pill-trailing の
   width が変わっても、right が固定なので pill-group 自体は伸縮に応じて
   左方向へ自然に広がるだけで、右端がズレたり見切れたりしない。 */
.pill-group {
  position: absolute;
  top: 10px;
  /* 画面端からの余白。@media (min-width: 769px) で上書きされる。 */
  right: 10px;
  /* Modal.vue の .modal-overlay(z-index:20) より下にして、設定ダイアログ表示中は
     このピルが上に乗って見えない・誤操作できてしまわないようにする。 */
  z-index: 10;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(80vw, 450px);
}

/* .pill-group（flex行）の直接の子。width を JS 実測値へ animate するクリップ用
   コンテナで、中身（.pill-trailing-inner）は常に content サイズで存在させ、
   この width だけを滑らかに広げ縮めることで、ボタンの出現/消失が位置の
   スライドと同期し、「一瞬右へはみ出してから戻る」ズレを起こさない。
   閉じるボタンはここに含めず .pill-group の直接の flex子にするため、
   横スクロール時にクリップされない。 */
.pill-trailing {
  min-width: 0;
  /* ボタン数が多い狭い画面・狭い分割ペイン（Pull/Push/Set Upstream/Dev Server等
     が同時に出る場合）で画面端・ペイン端からはみ出したボタンが見えない・
     押せなくなるのを防ぐ。可変個数を1行に収めるのではなく、上限幅（実測した
     ペイン幅基準、script側の trailingMaxWidth）を設けて横スクロールで到達
     可能にする。 */
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
  gap: 6px;
}

.pill-trailing::-webkit-scrollbar {
  display: none;
}

.terminal-info-pill {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid rgba(59, 66, 97, 0.5);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  color: var(--text-secondary);
  opacity: 1;
  font-size: 13px;
  line-height: 1.2;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: pointer;
  gap: 6px;
  /* flex-shrink:0（デフォルトの1のまま放置しない）: 展開ボタン群のポップ
     アニメーション中に、このピル自体の幅が兄弟の伸縮に引っ張られて揺れる
     ことがないよう、ピル本体の幅は常に自分のコンテンツだけで決まるようにする。 */
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
  min-height: 32px;
  height: 32px;
  max-height: 32px;
  min-width: 32px;
  padding: 0 10px;
  gap: 4px;
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  border: 1px solid rgba(59, 66, 97, 0.5);
  font-size: 12px;
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
  min-height: 32px;
  flex-shrink: 0;
  padding: 0 10px;
  border: 1px solid rgba(59, 66, 97, 0.5);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
}

/* button 自体は color:var(--text-secondary)（ラベル文字用）だが、
   アイコンだけそのまま継承すると他のアイコン（branch/changes等は
   var(--text-muted)）より明るく見えて浮くため、アイコンだけ揃える。 */
.pill-devserver-btn .mdi {
  color: var(--text-muted);
}

.pill-devserver-text {
  font-size: 12px;
  white-space: nowrap;
}

.pill-numstat-btn {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  flex-shrink: 0;
  border: 1px solid rgba(59, 66, 97, 0.5);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

/* アイコン単体表示時、button の font-size（数字用の12px）のままだと他の
   アイコンボタン（14px）より小さく見え、周りの余白だけ目立ってしまうため、
   アイコンだけ他ボタンと揃えた大きさにする。 */
.pill-numstat-btn .mdi {
  font-size: 14px;
}

.numstat-files {
  color: var(--warning);
}

.pill-branch-btn {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 140px;
  border: 1px solid rgba(59, 66, 97, 0.5);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.pill-branch-btn .mdi {
  flex-shrink: 0;
  font-size: 14px;
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

/* 通常時はアイコンのみ・ラベルは幅0に畳んでおく。ラベルは値が変化した
   時だけ数秒間 peek 表示する（下記 .peeking）。ホバーでは展開しない
   （ホバーのたびに幅が動いて隣接ボタンの位置がガタつくため）。PCでの
   説明は各ボタンの data-tooltip に任せる。peek表示中は .pill-trailing
   側のwidth transitionを止めて他ボタンを巻き込まないようにしている
   （script側 watch(peekingKey, ...) 参照）ため、ラベル自身のこの
   transitionだけがそのボタンの中でローカルに再生され、隣接ボタンは
   動かない。 */
/* max-width/margin-left はレイアウト確保用（ここは瞬時に切り替え、
   .pill-trailing 側の他ボタンを巻き込んだ横スライドを起こさない）。
   実際に見える伸縮アニメーションは clip-path のみで行い、右端を
   起点に左へ伸びる／右へ縮む見た目にする（文字を歪ませる
   scaleXではなく、あくまで見える範囲を変えるクリッピングにする）。 */
.pill-label-hover {
  display: inline-block;
  max-width: 0;
  margin-left: 0;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  clip-path: inset(0 0 0 100%);
  transition: clip-path 0.2s ease, opacity 0.15s ease;
}

.pill-label-hover.peeking {
  max-width: 160px;
  margin-left: 4px;
  opacity: 1;
  clip-path: inset(0 0 0 0%);
}

.numstat-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* PCでピルをホバーした時、アクティブなワークスペースピルと同じ地色に
   することで「今触れている対象」がわかるようにする。低不透明度だと
   端末出力が透けて他ピルより薄く見える問題が既出のため、他ピルと同じ
   不透明度を保ったまま色味だけアクセントに寄せた配色（アクティブ時の
   ワークスペースピルと同じ色）を使う。 */
@media (hover: hover) and (pointer: fine) {
  .pill-branch-btn:hover,
  .pill-numstat-btn:hover,
  .pill-devserver-btn:hover,
  .terminal-info-pill:hover {
    background: rgba(38, 56, 82, 0.92);
  }
}

.terminal-info-pill.dragging {
  opacity: 0.5;
}

.pill-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  width: 32px;
  flex-shrink: 0;
  padding: 0;
  border-radius: 999px;
  font-size: 16px;
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

/* .terminal-info-pill-info の gap:6px はアイコンバッジ同士の間隔用。
   ラベルが畳まれている間はこの gap ぶんも見た目の余白になってしまうため、
   畳んでいる間は同じ幅だけ負のmarginで打ち消し、展開時に元へ戻す。 */
.pill-workspace-label.pill-label-hover {
  margin-left: -6px;
}

.pill-workspace-label.pill-label-hover.peeking {
  margin-left: 0;
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

/* アクティブなペインのワークスペースピルは背景色でアクセントを付ける
   （枠線は変えない）。タブバーのアクティブタブと同じ配色
   rgba(130,170,255,0.12) は不透明度が低すぎ、端末の出力（背景が
   一定でないツールバーの上ではなく端末画面に浮かせて表示している）が
   透けて他ピルより薄い＝透明に見えてしまうため、他ピルと同程度の
   不透明度を保ったまま色味だけアクセントに寄せる。 */
.terminal-pane.active .terminal-info-pill {
  background: rgba(38, 56, 82, 0.92);
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

  .pill-branch-btn {
    max-width: none;
  }
}

</style>
