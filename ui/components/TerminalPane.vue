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
        :class="{ 'pill-group-bottom': layoutStore.isPanelBottom }"
        ref="pillEl"
      >
        <Transition name="pill-fade" mode="out-in">
        <div
          v-if="peekingKey"
          :key="peekingKey"
          class="pill-chip pill-peek-wide"
          :class="peekColorClass"
        >
          <span
            v-if="peekingKey === 'workspace' && (tab.wsIcon || tab.icon)"
            class="pill-peek-icon-slot"
            v-html="renderIconStr((tab.wsIcon || tab.icon).name, (tab.wsIcon || tab.icon).color, 16)"
          ></span>
          <span v-else class="mdi pill-peek-icon" :class="peekIconClass"></span>
          <span class="pill-peek-text pill-peek-marquee" :style="{ maxWidth: trailingMaxWidth + 'px' }">
            <span
              :ref="setMarqueeTextEl"
              class="pill-peek-marquee-text"
              :class="{ 'pill-peek-marquee-run': marqueeRun }"
              :style="marqueeRun ? { animationDuration: PILL_MORE_PEEK_DURATION_MS + 'ms' } : null"
            >
              <template v-if="peekingKey === 'changes'">
                <span v-if="changedFiles > 0" class="pill-peek-changes-files">{{ changedFiles }}F</span>
                <span class="pill-peek-changes-plus">+{{ insertions }}</span>
                <span class="pill-peek-changes-minus">-{{ deletions }}</span>
              </template>
              <template v-else-if="peekingKey === 'branch'">
                {{ paneWorkspace?.branch || '' }}<span v-if="ahead > 0" class="pill-peek-branch-ahead"> ↑{{ ahead }}</span><span v-if="behind > 0" class="pill-peek-branch-behind"> ↓{{ behind }}</span><span v-if="branchDoneLabel" class="pill-peek-branch-done"> {{ branchDoneLabel }}</span>
              </template>
              <template v-else>{{ peekText }}</template>
            </span>
          </span>
        </div>
        <div v-else key="normal" class="pill-normal-group">
        <div
          class="pill-trailing"
          :style="{ maxWidth: trailingMaxWidth + 'px' }"
        >
          <div class="pill-trailing-inner">
              <template v-for="key in infoPillConfig.order" :key="key">
              <button
                v-if="key === 'files' && (isGitRepo || tab.sessionId) && infoPillConfig.files"
                type="button"
                class="pill-chip pill-devserver-btn pill-files-btn"
                :aria-label="filesTooltip"
                :data-tooltip="filesTooltip"
                @pointerdown.stop
                @click.stop="openFiles"
              >
                <span class="mdi mdi-folder-outline"></span>
              </button>
              <button
                v-else-if="key === 'history' && isGitRepo && infoPillConfig.history"
                type="button"
                class="pill-chip pill-devserver-btn pill-history-btn"
                :aria-label="historyTooltip"
                :data-tooltip="historyTooltip"
                @pointerdown.stop
                @click.stop="openHistory"
              >
                <span class="mdi mdi-history"></span>
              </button>
              <button
                v-else-if="key === 'changes' && isGitRepo && isDirty && infoPillConfig.changes"
                type="button"
                class="pill-chip pill-numstat-btn"
                :aria-label="changesTooltip"
                :data-tooltip="changesTooltip"
                @pointerdown.stop
                @click.stop="openChanges"
              >
                <span class="mdi mdi-file-document-edit-outline"></span>
              </button>
              <button
                v-else-if="key === 'branch' && isGitRepo && infoPillConfig.branch"
                type="button"
                class="pill-chip pill-branch-btn"
                :aria-label="branchTooltip"
                :data-tooltip="branchTooltip"
                @pointerdown.stop
                @click.stop="openBranch"
              >
                <span class="mdi mdi-source-branch"></span>
                <span v-if="ahead > 0" class="pill-branch-count push-count"><span class="mdi mdi-arrow-up-thin"></span>{{ ahead }}</span>
                <span v-if="behind > 0" class="pill-branch-count pull-count"><span class="mdi mdi-arrow-down-thin"></span>{{ behind }}</span>
              </button>
              <button
                v-else-if="key === 'prs' && branchPR && infoPillConfig.prs"
                type="button"
                class="pill-chip pill-devserver-btn pill-pr-btn"
                :aria-label="prsTooltip"
                :data-tooltip="prsTooltip"
                @pointerdown.stop
                @click.stop="openPRs"
              >
                <span class="mdi mdi-source-pull"></span>
              </button>
              <button
                v-else-if="key === 'actions' && visibleBranchAction && infoPillConfig.actions"
                type="button"
                class="pill-chip pill-devserver-btn"
                :class="actionStatusClass"
                :aria-label="actionsTooltip"
                :data-tooltip="actionsTooltip"
                @pointerdown.stop
                @click.stop="openActions"
              >
                <span class="mdi" :class="actionStatusIcon"></span>
              </button>
              <button
                v-else-if="key === 'devserver' && devServerEntry && infoPillConfig.devserver"
                type="button"
                class="pill-chip pill-devserver-btn pill-server-btn"
                :aria-label="devServerTooltip"
                :data-tooltip="devServerTooltip"
                @pointerdown.stop
                @click.stop="openDevServer"
              >
                <span class="mdi mdi-server"></span>
              </button>
              <button
                v-else-if="key === 'add' && !isGitRepo && tab.sessionId && infoPillConfig.add"
                type="button"
                class="pill-chip pill-devserver-btn pill-add-btn"
                aria-label="Add or open this directory as a workspace"
                data-tooltip="Add or open this directory as a workspace"
                @pointerdown.stop
                @click.stop="registerCurrentDir"
              >
                <span class="mdi mdi-folder-plus-outline"></span>
              </button>
              <button
                v-else-if="key === 'dispatch' && tabDispatchItems.length > 0 && infoPillConfig.dispatch"
                type="button"
                class="pill-chip pill-devserver-btn pill-dispatch-btn"
                :aria-label="dispatchTooltip"
                :data-tooltip="dispatchTooltip"
                @pointerdown.stop
                @click.stop="openDispatch"
              >
                <span class="mdi mdi-tray-full"></span>
                <span v-if="tabDispatchItems.length > 1" class="pill-branch-count">{{ tabDispatchItems.length }}</span>
              </button>
              </template>
          </div>
        </div>
        <div
          class="terminal-info-pill"
          :class="{ 'tab-activity': tab._activity, 'pill-working': agentState === 'working' }"
          :data-tooltip="pillTooltip"
          :aria-label="pillTooltip"
          role="button"
          tabindex="0"
          @click="activatePill"
          @keydown="onPillKeydown"
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
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import { ACTIVE_FIT_DELAY_MS, PILL_MORE_PEEK_DURATION_MS } from "../utils/constants.js";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useTerminalPaste } from "../composables/useTerminalPaste.js";
import { useConfirm } from "../composables/useConfirm.js";
import { confirmCloseTab } from "../utils/tab-close-confirm.js";
import { useTerminalPaneGestures } from "../composables/useTerminalPaneGestures.js";
import { useCircleKeyPad } from "../composables/useCircleKeyPad.js";
import { useWorkspaceGitStatus } from "../composables/useWorkspaceGitStatus.js";
import { useIsMobile } from "../composables/useIsMobile.js";
import { useApi } from "../composables/useApi.js";
import { usePreviewPorts } from "../composables/usePreviewPorts.js";
import { useWorkspacePRs } from "../composables/useWorkspacePRs.js";
import { useWorkspaceActions } from "../composables/useWorkspaceActions.js";
import { useInfoPillConfigStore } from "../stores/info-pill-config.js";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.js";
import CircleKeyPad from "./CircleKeyPad.vue";
import StatusOverlay from "./StatusOverlay.vue";
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
const { isDirty, isGitRepo, hasUpstream, ahead, behind, changedFiles, insertions, deletions } = useWorkspaceGitStatus(paneWorkspace, isMobile);

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
const { prsByWorkspace, fetchPRs, startPolling: startPRsPolling, stopPolling: stopPRsPolling } = useWorkspacePRs();
const branchPR = computed(() => {
  if (!isGitRepo.value || !props.tab.workspace) return null;
  const list = prsByWorkspace.value[props.tab.workspace];
  if (!list || !paneWorkspace.value?.branch) return null;
  return list.find((pr) => pr.headRefName === paneWorkspace.value.branch) || null;
});

// GitHub Actionsピルも同様に「現在のブランチの最新run」がある時だけ表示する。
// 実行中→完了への遷移をピルに反映するため、表示中は定期的に再取得する
// （参照カウント式のポーリングはuseWorkspaceActions側に集約）。
const { runsByWorkspace, fetchRuns, startPolling: startActionsPolling, stopPolling: stopActionsPolling } = useWorkspaceActions();
const branchAction = computed(() => {
  if (!isGitRepo.value || !props.tab.workspace) return null;
  const list = runsByWorkspace.value[props.tab.workspace];
  if (!list || !paneWorkspace.value?.branch) return null;
  return list.find((run) => run.headBranch === paneWorkspace.value.branch) || null;
});

// failure以外で完了したrunはピル自体を表示しない（失敗中・実行中のrunだけ知らせる。
// success以外にもcancelled/skipped/timed_out等のconclusionがあり、それらは
// 実害のない終了として扱う）。
const visibleBranchAction = computed(() => {
  const run = branchAction.value;
  if (!run) return null;
  if (run.status === "completed" && run.conclusion !== "failure") return null;
  return run;
});

const githubWorkspaceKey = computed(() => (isGitRepo.value && paneWorkspace.value?.github_url) ? props.tab.workspace : null);

watch(
  githubWorkspaceKey,
  (workspace, prevWorkspace) => {
    if (prevWorkspace) {
      stopPRsPolling(prevWorkspace);
      stopActionsPolling(prevWorkspace);
    }
    if (workspace) {
      fetchPRs(workspace);
      fetchRuns(workspace);
      startPRsPolling(workspace);
      startActionsPolling(workspace);
    }
  },
  { immediate: true },
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

function openPRs() {
  if (!props.tab.workspace) return;
  workspaceStore.selectedWorkspace = props.tab.workspace;
  emit("git:openFileModal", { pane: "prs" });
}

function openActions() {
  if (!props.tab.workspace) return;
  workspaceStore.selectedWorkspace = props.tab.workspace;
  emit("git:openFileModal", { pane: "actions" });
}

const { queue: dispatchQueue } = useDispatchConfirm();
const tabDispatchItems = computed(() => {
  if (!props.tab.workspace) return [];
  return dispatchQueue.value.filter((item) =>
    (item.request.effective_workspace || item.request.workspace) === props.tab.workspace);
});

// 1件だけなら詳細（DispatchRunView）へ直接飛び、複数ある時はどれを開くか
// 選べるよう一覧（DispatchQueueConfig）を開く。
function openDispatch() {
  if (tabDispatchItems.value.length === 1) {
    emit("settings:open", { view: "DispatchRunView", state: { itemId: tabDispatchItems.value[0].id } });
  } else {
    emit("settings:open", { view: "DispatchQueueConfig" });
  }
}

const agentState = computed(() => terminalStore.agentStates[props.tab.sessionId] || "");
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

const pillTooltip = computed(() => {
  const name = props.tab.workspace || props.tab.label || "";
  const action = layoutStore.isTouchDevice ? "Tap for details" : "Click for details";
  return name ? `${name}  ·  ${action}` : action;
});

// アイコンのみのボタンでも、PCでホバーした時にその時点の実際の値
// （ブランチ名・変更行数・Dev Serverの接続先）が data-tooltip で
// わかるようにする。固定の説明文言だけだと、展開しないと現在値を
// 確認できないため。
const branchTooltip = computed(() => {
  const name = paneWorkspace.value?.branch || "";
  const parts = [];
  if (ahead.value > 0) parts.push(`${ahead.value} to push`);
  if (behind.value > 0) parts.push(`${behind.value} to pull`);
  if (!hasUpstream.value) parts.push("no upstream");
  return parts.length ? `Branches: ${name} (${parts.join(", ")})` : `Branches: ${name}`;
});
const filesTooltip = computed(() =>
  isGitRepo.value ? "Browse files" : "Browse files in this terminal's directory",
);
const changesTooltip = computed(() =>
  `Changes: ${changedFiles.value}F +${insertions.value} -${deletions.value}`,
);
const historyTooltip = computed(() => {
  const msg = (paneWorkspace.value?.last_commit_message || "").split("\n")[0].trim();
  return msg ? `History: ${msg}` : "History";
});
const devServerTooltip = computed(() => {
  const p = devServerEntry.value;
  if (!p) return "Dev Server";
  return `Dev Server: ${p.scheme || "http"}://${location.hostname}:${p.proxy_port}`;
});
const dispatchTooltip = computed(() => {
  const items = tabDispatchItems.value;
  if (items.length === 1) {
    const req = items[0].request;
    return `Dispatch: ${req.job && req.job !== "terminal" ? req.job : "run"}`;
  }
  return items.length ? `Dispatch: ${items.length} pending` : "Dispatch";
});

const prsTooltip = computed(() => {
  const pr = branchPR.value;
  return pr ? `GitHub PR #${pr.number}: ${pr.title}` : "GitHub PRs";
});

const actionsTooltip = computed(() => {
  const run = branchAction.value;
  if (!run) return "GitHub Actions";
  return `GitHub Actions: ${run.name} (${run.conclusion || run.status})`;
});

// 実行状況で色を変える（成功runはvisibleBranchActionで既に非表示のため、
// ここに来るのは失敗=エラー色・進行中=警告色のみ）。色だけで状態を示さない
// よう、アイコン自体も状態ごとに変える（AGENTS.md: 色のみで状態を示さない）。
const actionStatusClass = computed(() => {
  const run = branchAction.value;
  if (!run) return "";
  if (run.status !== "completed") return "action-status-running";
  if (run.conclusion === "failure") return "action-status-failure";
  return "";
});
const actionStatusIcon = computed(() => {
  const run = branchAction.value;
  if (!run || run.status !== "completed") return "mdi-progress-clock";
  if (run.conclusion === "failure") return "mdi-alert-circle-outline";
  return "mdi-cog-play-outline";
});

// 成功で完了した瞬間だけpeekで一度知らせる（通常表示のボタン自体は成功時
// visibleBranchActionでずっと非表示のまま）。
const isBranchActionSuccess = computed(() =>
  branchAction.value?.status === "completed" && branchAction.value?.conclusion === "success",
);

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
  // 各キーは対応するボタンの v-if 条件（infoPillConfig.xxx含む）と揃える。
  // 揃えないと、設定で非表示にしたピルの変化が findChangedTrailingItem に
  // 拾われてしまい、実際に表示されている別のピルの変化が同じ枠を奪われて
  // peekされない（見えないボタンがpeekの権利を横取りする）。
  if ((isGitRepo.value || props.tab.sessionId) && infoPillConfig.files) {
    items.push({ key: "files", text: "Files" });
  }
  if (isGitRepo.value && isDirty.value && infoPillConfig.changes) {
    items.push({ key: "changes", text: `${changedFiles.value}F +${insertions.value} -${deletions.value}` });
  }
  if (isGitRepo.value && infoPillConfig.branch) {
    // branchParts は isMobile（画面回転で変わりうる）に応じて省略表示形式が
    // 変わるため、そのまま text にすると回転しただけで「ブランチが変わった」
    // と誤検知して peek が発火してしまう。表示形式に依存しない生のブランチ名を使う。
    // ahead/behind（Push/Pullバッジ）もこのボタン自身に描画されるため、
    // 同じ"branch"キーのシグネチャに含める（別キーにすると対応するボタンが
    // 無いため、findChangedTrailingItemに拾われてもpeekが表示されない）。
    // history より前に置く: ブランチ切替え時は最終コミットメッセージも同時に
    // 変わり、両方とも変化扱いになる。findChangedTrailingItemは並び順で最初の
    // 変化を返すため、historyが先だとブランチ変更がhistoryのpeekに奪われて
    // しまう。ブランチ切替えの通知としてはbranch側を優先したい。
    items.push({ key: "branch", text: `${paneWorkspace.value?.branch || ""}:${ahead.value}:${behind.value}` });
  }
  if (isGitRepo.value && infoPillConfig.history) {
    items.push({ key: "history", text: paneWorkspace.value?.last_commit_message || "" });
  }
  if (branchPR.value && infoPillConfig.prs) {
    items.push({ key: "prs", text: `${branchPR.value.number}:${branchPR.value.title}` });
  }
  if (branchAction.value && infoPillConfig.actions) {
    // 成功で完了した瞬間もpeekで一度知らせたいため、通常時は非表示になる
    // successも含め branchAction（visibleBranchActionでフィルタする前の値）
    // を変化検出に使う。
    items.push({ key: "actions", text: `${branchAction.value.id}:${branchAction.value.status}:${branchAction.value.conclusion}` });
  }
  if (devServerEntry.value && infoPillConfig.devserver) {
    items.push({ key: "devserver", text: `Server:${devServerEntry.value.proxy_port}` });
  }
  if (!isGitRepo.value && props.tab.sessionId && infoPillConfig.add) {
    items.push({ key: "add", text: "Add" });
  }
  if (tabDispatchItems.value.length > 0 && infoPillConfig.dispatch) {
    items.push({ key: "dispatch", text: tabDispatchItems.value.map((i) => i.id).join(",") });
  }
  return items;
});

// アイコン群のどれかの値が更新された時、ピル群全体を隠し、変化した対象の
// アイコン + 情報テキストだけを乗せた1本の長いピル（.pill-peek-wide）を
// 数秒だけ表示する（PC・モバイル共通、PILL_MORE_PEEK_DURATION_MS）。
const peekingKey = ref(null);
let prevTrailingSignature = trailingItemsSignature(trailingPeekItems.value);
let pillMorePeekTimer = null;
// branchのpeekで矢印（ahead/behind）が消えた瞬間、ブランチ名の横に
// 「Push Done」「Pull Done」を出す（下記 watch(trailingPeekItems, ...) 内で設定）。
const branchDoneLabel = ref("");
// paneWorkspace は workspaceStore.allWorkspaces（非同期フェッチ）に依存するため、
// マウント直後は未解決（undefined）で isGitRepo 等が一時的に false になり得る。
// このタイミングで prevTrailingSignature を確定させると、ワークスペース情報が
// 届いた瞬間に「branch が新規に現れた」と誤検知して、畳んだ状態でも
// Branches ボタンが一瞬 peek 表示されてしまう。ワークスペースが一度でも
// 解決するまでは変化検出を行わず、解決した最初の1回はベースラインの
// 更新だけ行って peek はスキップする。
let workspaceEverResolved = paneWorkspace.value !== undefined;
// last_commit_message は paneWorkspace 自体が解決した後もさらに遅れて
// 非同期ロードされる（useWorkspaceGitStatus の statusLoading 参照）。
// これを "history" の変化検出にそのまま使うと、通常のロード完了時にも
// 「新しくコミットされた」と誤検知してpeekが発火してしまうため、
// 初めて値が解決した1回だけベースラインを更新して変化扱いにしない。
let historyMessageEverResolved = paneWorkspace.value?.last_commit_message !== undefined;
// PR一覧もfetchPRsによる非同期取得のため、初回のロード完了を
// 「新しくPRが作られた」と誤検知しないよう同様のガードをかける。
function prsResolvedFor(workspace) {
  return !!workspace && prsByWorkspace.value[workspace] !== undefined;
}
let prsEverResolved = prsResolvedFor(props.tab.workspace);
// GitHub Actionsのrun一覧も同様に非同期取得のため、同じガードをかける。
function actionsResolvedFor(workspace) {
  return !!workspace && runsByWorkspace.value[workspace] !== undefined;
}
let actionsEverResolved = actionsResolvedFor(props.tab.workspace);

// peekingKeyをkeyに切り替え、数秒後に自動で閉じるタイマーを張り直す
// （アニメーション無しで即座に切り替える。旧: 新規マウント要素でCSS
// transitionが無音化する問題を避けるための二重rAF遅延があったが、
// transition自体を廃止したため不要になった）。
function triggerPeek(key) {
  if (pillMorePeekTimer) clearTimeout(pillMorePeekTimer);
  peekingKey.value = key;
  pillMorePeekTimer = setTimeout(() => {
    peekingKey.value = null;
    pillMorePeekTimer = null;
  }, PILL_MORE_PEEK_DURATION_MS);
}

watch(trailingPeekItems, (items) => {
  const nextSignature = trailingItemsSignature(items);
  const historyJustResolved = !historyMessageEverResolved && paneWorkspace.value?.last_commit_message !== undefined;
  if (historyJustResolved) {
    historyMessageEverResolved = true;
    prevTrailingSignature.set("history", nextSignature.get("history"));
  }
  const prsJustResolved = !prsEverResolved && prsResolvedFor(props.tab.workspace);
  if (prsJustResolved) {
    prsEverResolved = true;
    prevTrailingSignature.set("prs", nextSignature.get("prs"));
  }
  const actionsJustResolved = !actionsEverResolved && actionsResolvedFor(props.tab.workspace);
  if (actionsJustResolved) {
    actionsEverResolved = true;
    prevTrailingSignature.set("actions", nextSignature.get("actions"));
  }
  const justResolved = !workspaceEverResolved && paneWorkspace.value !== undefined;
  if (justResolved) workspaceEverResolved = true;
  if (workspaceEverResolved && !justResolved) {
    const changed = findChangedTrailingItem(items, prevTrailingSignature);
    if (changed) {
      if (changed.key === "branch") {
        // 直前のシグネチャ（branch:ahead:behind）と比べ、ahead/behindが
        // >0 から 0 へ変わった＝push/pullが完了した瞬間だけラベルを出す。
        const [, prevAheadStr, prevBehindStr] = (prevTrailingSignature.get("branch") || "").split(":");
        const pushDone = Number(prevAheadStr) > 0 && ahead.value === 0;
        const pullDone = Number(prevBehindStr) > 0 && behind.value === 0;
        branchDoneLabel.value = [pushDone && "Push Done", pullDone && "Pull Done"].filter(Boolean).join(" · ");
      } else {
        branchDoneLabel.value = "";
      }
      triggerPeek(changed.key);
    }
  }
  prevTrailingSignature = nextSignature;
}, { deep: true });

// Dev Serverが検出されなくなった（実際に停止した）瞬間だけ知らせる。
// trailingPeekItemsはdevServerEntryが無い間キー自体を積まないため、
// 上のfindChangedTrailingItemでは「消えたこと」を検知できない
// （新規出現/値変化しか拾えない）。devServerEntry自体を直接見て、
// 真→偽への遷移だけを拾う（初回のnullや既に偽のままの変化は無視）。
watch(devServerEntry, (entry, prevEntry) => {
  if (!entry && prevEntry) triggerPeek("devserver-stop");
});

// .pill-peek-wide に表示するアイコン(mdiクラス)。ワークスペース名の変化は
// テンプレート側で tab.wsIcon/tab.icon の実アイコン（renderIconStr）を
// 直接使うため、ここでは対象外。
const peekIconClass = computed(() => {
  switch (peekingKey.value) {
    case "files": return "mdi-folder-outline";
    case "history": return "mdi-history";
    case "changes": return "mdi-file-document-edit-outline";
    case "branch": return "mdi-source-branch";
    case "prs": return "mdi-source-pull";
    case "actions": return isBranchActionSuccess.value ? "mdi-check-circle-outline" : actionStatusIcon.value;
    case "devserver": return "mdi-server";
    case "devserver-stop": return "mdi-server-off";
    case "add": return "mdi-folder-plus-outline";
    case "dispatch": return "mdi-tray-full";
    default: return "";
  }
});

// 対応する通常ピルのアイコン色と揃える。history/branch/actionsはアイコンだけ
// 状態色にし、テキスト（コミットメッセージ/ブランチ名/action名）は通常色
// （白）のまま読みやすく保つ（pill-peek-icon-only。changes/prsはテキストごと
// 色付けする従来通りの挙動）。
const peekColorClass = computed(() => {
  switch (peekingKey.value) {
    case "history": return ["pill-peek-pink", "pill-peek-icon-only"];
    case "changes": return "pill-peek-warning";
    case "prs": return "pill-peek-purple";
    case "branch": return ["pill-peek-success", "pill-peek-icon-only"];
    case "actions":
      if (isBranchActionSuccess.value) return ["pill-peek-success", "pill-peek-icon-only"];
      if (actionStatusClass.value === "action-status-failure") return ["pill-peek-error", "pill-peek-icon-only"];
      if (actionStatusClass.value === "action-status-running") return ["pill-peek-warning", "pill-peek-icon-only"];
      return "";
    case "devserver": return "pill-peek-accent";
    case "dispatch": return "pill-peek-warning";
    default: return "";
  }
});

// History はもう10文字に切り詰めない（ピル自体が内容に合わせて伸びるため）。
// changes/branch は複数トーンの色分け表示のためテンプレート側で直接組み立てる
// ので、ここでは対象外（他のキーのみ扱う）。
const peekText = computed(() => {
  switch (peekingKey.value) {
    case "files": return "Files";
    case "history": return (paneWorkspace.value?.last_commit_message || "").split("\n")[0].trim() || "History";
    case "prs": return branchPR.value ? `#${branchPR.value.number} ${branchPR.value.title}` : "";
    case "actions": return branchAction.value
      ? `[${branchAction.value.name}] ${branchAction.value.conclusion || branchAction.value.status}`
      : "";
    case "devserver": return devServerEntry.value ? `Dev Server :${devServerEntry.value.proxy_port}` : "Server";
    case "devserver-stop": return "Dev Server Stop";
    case "add": return "Add";
    case "dispatch": return dispatchTooltip.value;
    case "workspace": return props.tab.workspace || props.tab.label || "";
    default: return "";
  }
});

// peekピルの内容が変化した時だけ再測定するための、キーごとの比較用シグネチャ。
// changes/branchはpeekTextを経由しない独自の色分け表示のため、それぞれの
// 元データから組み立てる。
const peekSignature = computed(() => {
  if (!peekingKey.value) return null;
  if (peekingKey.value === "changes") {
    return `changes:${changedFiles.value}:${insertions.value}:${deletions.value}`;
  }
  if (peekingKey.value === "branch") {
    return `branch:${paneWorkspace.value?.branch || ""}:${ahead.value}:${behind.value}`;
  }
  return `${peekingKey.value}:${peekText.value}`;
});

// peekピルのラベルがピル幅に収まっている時はマーキーで流さない（収まって
// いるのに動かすと落ち着かないため）。収まらない時だけ、末尾が見えた
// ところで止める1回きりのスクロールにする（下記 .pill-peek-marquee-run、
// infiniteループはしない）。History以外の全ラベルにも同じ扱いを揃える。
const marqueeRun = ref(false);
const marqueeTextEl = ref(null);

function measureMarquee() {
  const el = marqueeTextEl.value;
  const container = el?.parentElement;
  marqueeRun.value = !!container && el.scrollWidth > container.clientWidth;
}

// peekピルは Transition(mode="out-in") 配下にあり、キー切替時は旧要素の
// leaveアニメーション完了を待ってから新要素がDOMへ挿入される。peekSignature
// の変化を起点に nextTick() だけで測るとこの挿入待ちより早く走ってしまい、
// marqueeTextEl がまだ null/旧要素のままで測定に失敗する（挿入後は再測定
// されず、動くべき時に動かないまま固定される）。実際にDOMへ挿入された瞬間
// （関数refのマウント時）にも測るようにして、このレースを避ける。
function setMarqueeTextEl(el) {
  marqueeTextEl.value = el;
  if (el) nextTick(measureMarquee);
}

watch(
  peekSignature,
  async (sig) => {
    if (!sig) { marqueeRun.value = false; return; }
    marqueeRun.value = false;
    await nextTick();
    if (marqueeTextEl.value) measureMarquee();
  },
);

// ワークスペースピル本体のタップ/クリックは Jobs/Files ペインを直接開く。
function activatePill() {
  if (props.tab.workspace) {
    workspaceStore.selectedWorkspace = props.tab.workspace;
    // ピルに ahead/behind（push/pullマーク）が出ている時は、その操作をする Branches ペインへ直接開く。
    // それ以外は Files ペインを開く。
    const hasPushPullMark = layoutStore.isSplitMode && isGitRepo.value && (ahead.value > 0 || behind.value > 0);
    emit("git:openFileModal", { pane: hasPushPullMark ? "branch" : "files" });
  } else if (props.tab.sessionId) {
    // ワークスペース未紐付けのベアターミナルでは cwd を読んで Files を開く
    openBareTerminalFiles();
  } else {
    emit("workspace:openModal");
  }
}

function onPillKeydown(e) {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  activatePill();
}

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
  if (githubWorkspaceKey.value) {
    stopPRsPolling(githubWorkspaceKey.value);
    stopActionsPolling(githubWorkspaceKey.value);
  }
  if (pillMorePeekTimer) { clearTimeout(pillMorePeekTimer); pillMorePeekTimer = null; }
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

/* Info Pills設定の「Position」で右下配置を選んだ場合。right はそのまま
   固定値を使い、上下だけ入れ替える。 */
.pill-group.pill-group-bottom {
  top: auto;
  bottom: 10px;
}

/* peekピル（pill-peek-wide）と、展開ボタン群・ワークスペースピル本体・
   閉じるボタンをまとめた .pill-normal-group は、1つの Transition
   (mode="out-in") のv-if/v-elseで排他的に表示される。ワークスペースピル・
   閉じるボタンも peek表示中は非表示になり peekピルへスペースを譲るが、
   通常表示側は全部まとめて1ブロックとしてフェードすることで、個別に
   フェードさせた時のような表示タイミングのズレを避ける。
   値が変化した時に表示する peekピルは、無駄に大きくせず内容に合わせた幅
   のまま表示する。上限だけ、キーによらず .pill-trailing と同じ
   trailingMaxWidth（実測したペイン幅からワークスペースピル・閉じるボタン
   ぶんを差し引いた値）を max-width に使う。ラベルがこの上限にも収まらない
   時だけ、末尾が見えるところで止まる1回きりのマーキーで流す（下記
   .pill-peek-marquee-run、scrollWidth実測でscript側が判定する）。 */
.pill-normal-group {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
}
/* 展開ボタン群（pill-devserver-btn/pill-numstat-btn/pill-branch-btn）と
   peekピル（pill-peek-wide）に共通のピル外観（枠線・角丸・背景・最低高さ）。
   個別ルールには padding/font-size/color 等の差分だけを残す。 */
.pill-chip {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 1px solid rgba(59, 66, 97, 0.9);
  border-radius: 999px;
  background: rgba(26, 27, 38, 0.88);
}

/* 非アクティブなペインのピル（展開ボタン群・peekピル）は沈んで見えるように
   暗くする。box-shadowは背景の上にしか乗らずアイコン（子要素）の色までは
   暗くならないため、要素全体を暗くできるopacityで揃える
   （ワークスペースピルと同じ扱い）。 */
.terminal-pane:not(.active) .pill-chip {
  opacity: 0.7;
}

.pill-peek-wide {
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 5px 14px;
  color: var(--text-secondary);
  font-size: 13px;
}

.pill-peek-icon,
.pill-peek-icon-slot {
  flex-shrink: 0;
  font-size: 15px;
  color: var(--text-muted);
}

.pill-peek-pink .pill-peek-icon,
.pill-peek-pink .pill-peek-text { color: var(--pink); }
.pill-peek-warning .pill-peek-icon,
.pill-peek-warning .pill-peek-text { color: var(--warning); }
.pill-peek-purple .pill-peek-icon,
.pill-peek-purple .pill-peek-text { color: var(--purple); }
.pill-peek-success .pill-peek-icon,
.pill-peek-success .pill-peek-text { color: var(--success); }
.pill-peek-error .pill-peek-icon,
.pill-peek-error .pill-peek-text { color: var(--error); }
/* Dev Serverは通常ピル（.pill-server-btn）と同じアクセント色をアイコンだけに
   使う（テキストは元々このクラスで色付けしないため icon-only 不要）。 */
.pill-peek-accent .pill-peek-icon { color: var(--accent); }

/* history/branch/actionsは状態をアイコンだけで示し、テキストは通常色（白）
   のまま読みやすく保つ（changes/prsはテキストごと色付けするため対象外）。
   上の .pill-peek-xxx .pill-peek-text ルールより詳細度を上げて上書きする。 */
.pill-peek-icon-only.pill-peek-pink .pill-peek-text,
.pill-peek-icon-only.pill-peek-success .pill-peek-text,
.pill-peek-icon-only.pill-peek-warning .pill-peek-text,
.pill-peek-icon-only.pill-peek-error .pill-peek-text {
  color: var(--text-secondary);
}

.pill-peek-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* changes/branchは複数の色分けspanを並べる。テンプレート上は改行区切りで
   並べているため、そのままだとVueのwhitespace condenseでタグ間の空白が
   消えて詰まって見える。inline-flex+gapで区切りを入れる（単一テキストの
   キーではgapは1要素しか無いため影響しない）。 */
.pill-peek-marquee-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* ピル幅に収まらない時だけ付与する（script側でscrollWidth実測）。ループ
   させず、末尾が見えたところで止める1回きりのスクロール。 */
.pill-peek-marquee-text.pill-peek-marquee-run {
  padding-left: 100%;
  animation: pill-peek-scroll linear 1 forwards;
}

@keyframes pill-peek-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-100%); }
}

/* changes/branch は複数の値を1行にまとめて表示するため、それぞれの意味に
   合わせて個別に色分けする（通常ピルの数字バッジ・Push/Pullカウントと
   同じ配色に揃える）。 */
.pill-peek-changes-files {
  color: var(--warning);
}

.pill-peek-changes-plus {
  color: var(--success);
}

.pill-peek-changes-minus {
  color: var(--error);
}

.pill-peek-branch-ahead {
  color: var(--accent);
}

.pill-peek-branch-behind {
  color: var(--warning);
}

.pill-peek-branch-done {
  color: var(--success);
  font-weight: 600;
}

/* peekピル⇔通常表示（.pill-normal-group）の切替えは、スライドさせず
   クロスフェードのみにする。 */
.pill-fade-enter-active,
.pill-fade-leave-active {
  transition: opacity 0.2s ease;
}

.pill-fade-leave-to { opacity: 0; }
.pill-fade-enter-from { opacity: 0; }

/* peekピルと排他的に表示される
   展開ボタン群のコンテナ。ボタンの出現/消失や幅の変化はアニメーションせず
   即座に反映する。 */
.pill-trailing {
  /* flex-basis:0 で「余った分だけ広がる」計算にする（flex-basis:auto だと
     中身の実サイズが基準になり、actionsピル追加等で兄弟（ワークスペース
     ピル・閉じるボタン）を画面外へ押し出すブラウザがあった）。 */
  flex: 1 1 0%;
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
  border: 1px solid rgba(59, 66, 97, 0.9);
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

.pill-devserver-btn {
  flex-shrink: 0;
  padding: 0 10px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
}

/* button 自体は color:var(--text-secondary)（ラベル文字用）。Actionsピルは
   失敗・実行中以外表示されない（visibleBranchAction）ため、アイコン色は
   その場合のフォールバックとしてのみ使う。 */
.pill-devserver-btn .mdi {
  color: var(--text-muted);
}

/* PR・Dev Serverピルはボタン自体が「対応するPR/検出済みDev Serverが
   ある時」だけ存在する（v-if）ため、Changes（.pill-numstat-btn）と同じく
   アイコンを常時アクティブ色にする（PRはGitHubのPRらしい紫）。 */
.pill-pr-btn .mdi {
  color: var(--purple);
}

.pill-server-btn .mdi {
  color: var(--accent);
}

.pill-history-btn .mdi {
  color: var(--pink);
}

.pill-files-btn .mdi {
  color: var(--accent);
}

.pill-add-btn .mdi {
  color: var(--accent);
}

.pill-dispatch-btn .mdi {
  color: var(--warning);
}

/* GitHub Actionsピルの実行状況を色で示す（アイコンだけ、地色は他と揃える）。
   成功runはvisibleBranchActionで非表示になるため、ここは失敗・進行中のみ。 */
.pill-devserver-btn.action-status-failure .mdi {
  color: var(--error);
}

.pill-devserver-btn.action-status-running .mdi {
  color: var(--warning);
}

.pill-numstat-btn {
  padding: 0 10px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

/* アイコン単体表示時、button の font-size（数字用の12px）のままだと他の
   アイコンボタン（14px）より小さく見え、周りの余白だけ目立ってしまうため、
   アイコンだけ他ボタンと揃えた大きさにする。このボタンはisDirty時にしか
   存在しない（=常に「変更あり」状態）ため、アイコンをアクティブ色にする
   （ワークスペースピルのダーティドットと同じ色に揃える）。 */
.pill-numstat-btn .mdi {
  font-size: 14px;
  color: #f5a623;
}

.pill-branch-btn {
  padding: 0 10px;
  flex-shrink: 1;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.pill-branch-btn .mdi {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--success);
}

/* Push(↑)/Pull(↓)件数。値がある時だけ表示される（v-if）ので常時表示で良い
   （他ピルのpeek-hover方式とは異なり、これは数字自体が主情報のため）。 */
.pill-branch-count {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-left: 4px;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.pill-branch-count .mdi {
  font-size: 13px;
}

/* .pill-branch-btn .mdi の color は直接指定のため継承では
   上書きできない。矢印アイコン自体にも同じ色を明示する。 */
.pill-branch-count.push-count,
.pill-branch-count.push-count .mdi {
  color: var(--accent);
}

.pill-branch-count.pull-count,
.pill-branch-count.pull-count .mdi {
  color: var(--warning);
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

/* 非アクティブなペインのワークスペースピルは沈んで見えるように暗くする
   （アイコンも含め要素全体をopacityで暗くする）。 */
.terminal-pane:not(.active) .terminal-info-pill {
  opacity: 0.7;
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

  .pill-group.pill-group-bottom {
    top: auto;
    bottom: 20px;
  }
}

</style>
