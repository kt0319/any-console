<template>
  <div class="workspace-detail">
    <!-- タブバー -->
    <div class="workspace-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="workspace-tab"
        :class="{ active: activePane === tab.key, 'tab-underline-active': activePane === tab.key }"
        :aria-label="tab.count ? `${tab.label} (${tab.count})` : tab.label"
        :data-tooltip="activePane === tab.key ? null : tab.label"
        @click="switchPane(tab.key)"
      >
        <span :class="['mdi', tab.icon]" :style="tab.iconColor ? { color: tab.iconColor } : null" aria-hidden="true"></span>
        <span class="workspace-tab-label" :class="{ 'workspace-tab-label-active': activePane === tab.key }" aria-hidden="true">{{ tab.label }}<span v-if="tab.count"> ({{ tab.count }})</span></span>
      </button>
    </div>

    <!-- タブコンテンツ -->
    <div class="workspace-tab-content">
      <div v-show="activePane === 'history'" class="file-modal-pane git-history-branch-pane">
        <div v-show="!isViewingCommitFiles" class="git-history-branch-branches">
          <div class="branch-summary-body" :class="{ 'branch-summary-body-expanded': branchSectionExpanded }">
            <GitChangeBranch ref="gitBranch" :expanded="branchSectionExpanded" @toggle="toggleBranchSection" />
          </div>
        </div>
        <GitHistory
          ref="gitHistory"
          @commit:expanded="isViewingCommitFiles = true"
          @commit:collapsed="onCommitCollapsed"
        />
      </div>
      <div v-show="activePane === 'files'" class="file-modal-pane">
        <FileBrowser
          ref="fileBrowser"
          :diffFile="selectedDiffFile"
          :diffMessage="diffMessage"
          :diffIsWorkingTree="selectedDiffIsWorkingTree"
          :diffCommitHash="selectedDiffCommitHash"
          :rootLabel="fileBrowserRootLabel"
          :terminalSessionId="terminalSessionId"
          @state="onFileBrowserState"
        />
      </div>
      <div v-if="activePane === 'changes'" class="file-modal-pane">
        <button
          v-if="stashCount"
          type="button"
          class="stash-summary-toggle"
          :class="{ 'stash-summary-toggle-expanded': stashSectionExpanded }"
          :aria-expanded="stashSectionExpanded"
          aria-controls="stash-summary-body"
          data-tooltip="Stash"
          @click="toggleStashSection"
        >
          <span class="mdi mdi-package-variant" aria-hidden="true"></span>
          <span class="stash-summary-toggle-label">Stash ({{ stashCount }})</span>
          <span class="mdi" :class="stashSectionExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" aria-hidden="true"></span>
        </button>
        <div v-if="stashSectionExpanded" id="stash-summary-body" class="stash-summary-body">
          <GitStash ref="gitStash" @count="onStashCount" />
        </div>
        <GitChanges ref="gitChanges" />
      </div>
      <div v-if="activePane === 'jobs'" class="file-modal-pane">
        <WorkspaceJobsPane ref="jobsPane" />
      </div>
      <div v-if="activePane === 'issues'" class="file-modal-pane">
        <GitHubIssuesPane ref="githubIssues" @count="issuesCount = $event" />
      </div>
      <div v-if="activePane === 'actions'" class="file-modal-pane">
        <GitHubActionsPane ref="githubActions" />
      </div>
      <div v-if="activePane === 'prs'" class="file-modal-pane">
        <GitHubPRsPane ref="githubPrs" @count="prsCount = $event" />
      </div>
      <div v-if="activePane === 'dispatch'" class="file-modal-pane">
        <DispatchRunView
          v-if="selectedDispatchId"
          :item-id="selectedDispatchId"
          @back="selectedDispatchId = null"
          @done="onDispatchRunDone"
        />
        <DispatchWorkspacePane v-else @select="selectedDispatchId = $event" />
      </div>
      <div v-show="activePane === 'select'" class="file-modal-pane">
        <TerminalSelectPane ref="terminalSelectPane" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, nextTick, onMounted, onUnmounted } from "vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitChanges from "./GitChanges.vue";
import GitChangeBranch from "./GitChangeBranch.vue";
import GitStash from "./GitStash.vue";
import WorkspaceJobsPane from "./WorkspaceJobsPane.vue";
import GitHubIssuesPane from "./GitHubIssuesPane.vue";
import GitHubActionsPane from "./GitHubActionsPane.vue";
import GitHubPRsPane from "./GitHubPRsPane.vue";
import DispatchWorkspacePane from "./DispatchWorkspacePane.vue";
import DispatchRunView from "./DispatchRunView.vue";
import TerminalSelectPane from "./TerminalSelectPane.vue";
import { on } from "../app-bridge.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "../composables/useApi.ts";
import { useToast } from "../composables/useToast.ts";
import { useModalView } from "../composables/useModalView.ts";
import { useWorkspaceCounts } from "../composables/useWorkspaceCounts.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { usePaneLoader } from "../composables/usePaneLoader.ts";
import { useDispatchConfirm } from "../composables/useDispatchConfirm.ts";
import { dispatchWorkspaceLabel } from "../utils/dispatch-request.ts";
import { workspaceDisplayName } from "../utils/worktree.ts";

const workspaceStore = useWorkspaceStore();
const { apiCommand, wsEndpoint } = useApi();
const toast = useToast();
const { confirm } = useConfirm();
const { modalTitle, viewState, modalBranch, updateViewState } = useModalView();
const {
  issuesCount,
  prsCount,
  stashCount,
  changesCount,
  hasGithub,
  primeFromCache,
  loadCounts,
} = useWorkspaceCounts();

const fileBrowser = ref<InstanceType<typeof FileBrowser> | null>(null);
const gitHistory = ref<InstanceType<typeof GitHistory> | null>(null);
const gitChanges = ref<InstanceType<typeof GitChanges> | null>(null);
const gitBranch = ref<InstanceType<typeof GitChangeBranch> | null>(null);
const gitStash = ref<InstanceType<typeof GitStash> | null>(null);
const githubIssues = ref<InstanceType<typeof GitHubIssuesPane> | null>(null);
const githubActions = ref<InstanceType<typeof GitHubActionsPane> | null>(null);
const githubPrs = ref<InstanceType<typeof GitHubPRsPane> | null>(null);
const jobsPane = ref<InstanceType<typeof WorkspaceJobsPane> | null>(null);
const terminalSelectPane = ref<InstanceType<typeof TerminalSelectPane> | null>(null);

// DispatchタブでDispatchWorkspacePane（一覧）→DispatchRunView（1件の詳細/実行）
// をローカルに切り替えるための状態。Settings側のpushViewには乗せない
// （別レイヤーとして開いてしまい、ワークスペース詳細の外に見えてしまうため）。
const selectedDispatchId = ref<string | null>(null);
// Run成功時、そのままセッションを見せたいのでワークスペース詳細ごと閉じる
// （WorkspaceDetailModal.vueがuseWorkspaceDetailNav.jsのcloseをprovideする）。
const closeWorkspaceDetail = inject<(() => void) | undefined>("closeWorkspaceDetail");
function onDispatchRunDone() {
  selectedDispatchId.value = null;
  closeWorkspaceDetail?.();
}

const activePane = ref("jobs");
// HistoryタブのBranch一覧は畳んだ状態を既定にし、シェブロンボタンで開閉する
// （常時ブランチ一覧を出すとコミット履歴の表示領域を圧迫するため）。
const branchSectionExpanded = ref(false);
// Changesタブに統合したStash一覧も同じパターンで既定は畳んだ状態にする
// （旧: 独立した「Stashes」タブ。ChangesとStashは両方「今のワークツリーの
// 未確定の変更」という同じ関心事なので1タブへ統合した）。
const stashSectionExpanded = ref(false);
// コミットのファイル一覧を見ている間はBranchヘッダーを隠し、履歴の
// 表示領域を圧迫しないようにする（GitHistoryのcommit:expanded/collapsed）。
const isViewingCommitFiles = ref(false);
const selectedDiffFile = ref("");
const diffMessage = ref("");
const selectedDiffIsWorkingTree = ref(false);
const selectedDiffCommitHash = ref("");

const { queue: dispatchQueue, recent: dispatchRecent } = useDispatchConfirm();
// タブのバッジ数字は承認待ち（pending）件数のみでよい（実行済みrecentは
// 件数に含めない）。ただしタブ自体の表示可否はrecentしか無い場合でも
// 履歴を見返せるよう、pending/recentのどちらかがあれば出す。
const dispatchPendingCount = computed(() => {
  const ws = workspaceStore.selectedWorkspace;
  if (!ws) return 0;
  return dispatchQueue.value.filter((item) => dispatchWorkspaceLabel(item.request) === ws).length;
});
const dispatchRecentCount = computed(() => {
  const ws = workspaceStore.selectedWorkspace;
  if (!ws) return 0;
  return dispatchRecent.value.filter((item) => dispatchWorkspaceLabel(item.request) === ws).length;
});

const fileBrowserDeep = ref(false);
const terminalSessionId = computed(() => viewState!.value?.detail?.terminalSessionId || "");
const fileBrowserRootLabel = computed(() => viewState!.value?.detail?.rootLabel || "");

function onFileBrowserState({ atRoot, fileOpen }) {
  fileBrowserDeep.value = !atRoot || fileOpen;
}

const filesBrowsing = computed(() => fileBrowserDeep.value || !!selectedDiffFile.value);

const isGitWorkspace = computed(() => !terminalSessionId.value && !!workspaceStore.currentWorkspace?.is_git_repo);

// タブ定義。count / iconColor / hidden はタブによって持たないものがあるため optional。
type WorkspaceTabDef = { key: string, icon: string, label: string, count?: number, iconColor?: string, hidden?: boolean };

const tabs = computed(() => {
  const isGit = isGitWorkspace.value;
  const list: WorkspaceTabDef[] = [
    {
      key: "files",
      icon: filesBrowsing.value ? "mdi-folder-open-outline" : "mdi-folder-outline",
      iconColor: "#14b8a6",
      label: "Files",
    },
    { key: "history", icon: "mdi-history", label: "History", iconColor: "var(--accent)", hidden: !isGit },
    { key: "changes", icon: "mdi-file-document-multiple-outline", label: "Changes", count: changesCount.value || 0, iconColor: "#f5a623", hidden: !isGit },
    { key: "issues", icon: "mdi-github", label: "Issues", count: issuesCount.value || 0, hidden: !isGit || !hasGithub.value || !issuesCount.value },
    { key: "prs", icon: "mdi-source-pull", label: "PRs", count: prsCount.value || 0, iconColor: "var(--purple)", hidden: !isGit || !hasGithub.value || !prsCount.value },
    { key: "actions", icon: "mdi-cog-play-outline", label: "Actions", iconColor: "#8c6c50", hidden: !isGit || !hasGithub.value },
    { key: "dispatch", icon: "mdi-inbox-arrow-down-outline", label: "Dispatch", iconColor: "var(--pink)", count: dispatchPendingCount.value || 0, hidden: !!terminalSessionId.value || (!dispatchPendingCount.value && !dispatchRecentCount.value) },
    { key: "select", icon: "mdi-content-copy", label: "Select & Copy" },
  ];
  return list.filter((t) => !t.hidden);
});

function updateViewTitle() {
  const ws = workspaceStore.currentWorkspace;
  modalTitle!.value = fileBrowserRootLabel.value || (ws ? workspaceDisplayName(ws) : (workspaceStore.selectedWorkspace || "Git"));
  if (modalBranch) modalBranch.value = "";
}


// ペインごとの once-load 状態（どのキーで読み込み済みか）は paneLoader に集約する。
// "view" はワークスペース/セッション切替の検出用（切替時に各ペインを無効化する）。
const paneLoader = usePaneLoader();

function loadBranchSection() {
  paneLoader.ensure("branch", workspaceStore.selectedWorkspace, () => {
    nextTick(() => {
      gitBranch.value?.load();
      gitBranch.value?.backgroundFetch();
    });
  });
}

function toggleBranchSection() {
  branchSectionExpanded.value = !branchSectionExpanded.value;
  if (branchSectionExpanded.value) loadBranchSection();
}

function expandBranchSection() {
  if (!branchSectionExpanded.value) {
    branchSectionExpanded.value = true;
    loadBranchSection();
  }
}

function loadStashSection() {
  nextTick(() => gitStash.value?.load());
}

function toggleStashSection() {
  if (stashSectionExpanded.value) {
    stashSectionExpanded.value = false;
  } else {
    expandStashSection();
  }
}

function expandStashSection() {
  if (!stashSectionExpanded.value) {
    stashSectionExpanded.value = true;
    loadStashSection();
  }
}

function clearDiffSelection() {
  selectedDiffFile.value = "";
  diffMessage.value = "";
  selectedDiffIsWorkingTree.value = false;
  selectedDiffCommitHash.value = "";
}

function handleBack() {
  if (activePane.value === "dispatch" && selectedDispatchId.value) {
    selectedDispatchId.value = null;
    return true;
  }
  if (activePane.value === "history" && gitHistory.value?.hasExpanded?.()) {
    gitHistory.value?.closeExpanded?.();
    clearDiffSelection();
    updateViewTitle();
    return true;
  }
  if (selectedDiffFile.value) {
    clearDiffSelection();
    return true;
  }
  return false;
}

function open(options) {
  options = options || {};
  const paneKey = options.pane || "jobs";
  // branchピル経由（paneKey === "branch"）だけはHistoryタブを開くと同時に
  // Branch一覧セクションも展開する。History タブ自体を直接開いた場合は
  // 従来通り畳んだ状態で開始する。stashも同様（旧Stashesタブへの外部リンク・
  // 通知経由の遷移との互換のため、paneKey === "stash" はChangesタブを開いて
  // Stashセクションを展開する）。
  const wantBranchExpanded = paneKey === "branch";
  const wantStashExpanded = paneKey === "stash";
  let resolvedPane = paneKey === "browser" ? "history" : paneKey;
  // 非 git ワークスペースで git 専用ペインが指定された場合は files にフォールバック
  const gitOnlyPanes = new Set(["jobs", "history", "changes", "branch", "stash", "issues", "actions", "prs"]);
  if (gitOnlyPanes.has(resolvedPane) && !workspaceStore.currentWorkspace?.is_git_repo) {
    resolvedPane = "files";
  }
  clearDiffSelection();
  updateViewTitle();

  const workspace = terminalSessionId.value ? null : workspaceStore.selectedWorkspace;
  if (workspace) {
    primeFromCache(workspace);
    loadCounts(workspace);
  }

  const filesKey = terminalSessionId.value || workspace;
  paneLoader.ensure("view", filesKey, () => {
    paneLoader.invalidate("history");
    paneLoader.invalidate("files");
    paneLoader.invalidate("branch");
    branchSectionExpanded.value = false;
    stashSectionExpanded.value = false;
    isViewingCommitFiles.value = false;
    selectedDispatchId.value = null;
  });

  switchPane(resolvedPane, { expandBranch: wantBranchExpanded, expandStash: wantStashExpanded });
  // dispatch通知タップ等、特定の1件を直接開きたい場合（vue-main.ts参照）。
  if (resolvedPane === "dispatch" && options.dispatchItemId) {
    selectedDispatchId.value = options.dispatchItemId;
  }
}

async function switchPane(key: string, opts: { expandBranch?: boolean, expandStash?: boolean } = {}) {
  // 後方互換: "github" → "issues"、"browser"/"branch" → "history"、"stash" → "changes"
  // （Branch/StashはそれぞれHistory/Changesタブへ統合。一覧は通常畳んだ状態で
  // 開始するが、branch/stashピル経由（opts.expandBranch/opts.expandStash）の
  // 場合だけ展開する）
  if (key === "github") key = "issues";
  if (key === "browser" || key === "branch") key = "history";
  if (key === "stash") key = "changes";

  activePane.value = key;
  updateViewState?.({ detail: { ...(viewState!.value?.detail || {}), pane: key } });
  updateViewTitle();

  if (key === "history") {
    nextTick(() => {
      // commit:expanded/collapsedの取りこぼし（タブ切替等で経由せず離脱した
      // 場合）でBranchヘッダーが隠れたまま復帰しなくなるのを防ぐため、
      // Historyタブに入るたびに実際の展開状態へ同期し直す。
      isViewingCommitFiles.value = !!gitHistory.value?.hasExpanded?.();
      paneLoader.ensure("history", workspaceStore.selectedWorkspace, () => gitHistory.value?.load());
      // 現在ブランチの行は折りたたみ時もセレクトボックスの先頭項目として
      // 常時表示するため、展開の有無に関わらずHistoryタブに入るたび読み込む。
      loadBranchSection();
      if (opts.expandBranch) expandBranchSection();
    });
  } else if (key === "changes") {
    nextTick(() => gitChanges.value?.loadWorkingTreeDiff());
    if (opts.expandStash) expandStashSection();
  } else if (key === "jobs") {
    nextTick(() => jobsPane.value?.load());
  } else if (key === "files") {
    nextTick(() => {
      const filesKey = terminalSessionId.value || workspaceStore.selectedWorkspace;
      paneLoader.ensure("files", filesKey, () => fileBrowser.value?.load());
    });
  }
  // issues/actions/prs は v-if + onMounted で自動ロード
  if (key === "select") {
    nextTick(() => terminalSelectPane.value?.refresh());
  }
}

function onStashCount(n) {
  stashCount.value = n;
}

function onCommitCollapsed() {
  isViewingCommitFiles.value = false;
  updateViewTitle();
}

const _offHandlers = [
  on("git:openFileModal", (detail) => {
    open(detail);
  }),

  on("worktree:open", ({ name, pane } = {}) => {
    if (name) workspaceStore.selectedWorkspace = name;
    open({ pane: pane || "jobs" });
  }),

  on("git:selectDirty", () => {
    clearDiffSelection();
  }),

  on("git:selectDiffFile", ({ path, isWorkingTree, commitHash }) => {
    switchPane("files");
    selectedDiffFile.value = path;
    diffMessage.value = "";
    selectedDiffIsWorkingTree.value = !!isWorkingTree;
    selectedDiffCommitHash.value = commitHash || "";
  }),

  on("git:browseToFolder", ({ path }) => {
    activePane.value = "files";
    clearDiffSelection();
    // navigateToPath が読み込みを担うため、files ペインはロード済み扱いにする
    paneLoader.markLoaded("files", workspaceStore.selectedWorkspace);
    updateViewTitle();
    nextTick(() => fileBrowser.value?.navigateToPath(path));
  }),

  on("git:commitDone", () => {
    if (activePane.value === "history") {
      gitHistory.value?.reload();
    } else {
      paneLoader.invalidate("history");
    }
  }),

  on("git:checkoutBranch", async ({ branch, remote }) => {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const { ok } = await apiCommand(wsEndpoint(workspace, "checkout"), { branch, remote }, { errorMessage: "Checkout failed" });
    if (!ok) return;
    workspaceStore.fetchStatuses();
    closeWorkspaceDetail?.();
    toast.success(`Switched branch to "${branch}"`);
  }),

  on("git:stashSave", async () => {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const { ok, data } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true }, { errorMessage: "Stash save failed" });
    if (!ok) return;
    const msg = data?.stdout?.trim() || "Stash saved";
    toast.success(msg);
    gitHistory.value?.reload();
  }),
];

onUnmounted(() => {
  _offHandlers.forEach((off) => off());
});

defineExpose({ handleBack });


onMounted(() => {
  const detail = viewState!.value?.detail;
  open(detail);
});
</script>

<style scoped>
.workspace-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
}

.file-modal-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* HistoryタブはBranch一覧をコミット履歴の上に置くが、既定では現在の
   ブランチ名 + シェブロンボタンだけの1行に畳んでおく（常時全部出すと
   コミット履歴の表示領域を圧迫するため）。クリックで開閉する。 */
.git-history-branch-branches {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
  border-bottom: 1px solid var(--border);
}

/* 現在ブランチの行（GitChangeBranch.vue内）がセレクトボックスの先頭項目 兼
   開閉トグルを兼ねるため、ここでは一覧全体を包む箱の見た目だけを持つ。
   開閉状態は枠線色で示す（AGENTS.md: 色のみで状態を示さない → キャレット
   の向き・アイコン変化はGitChangeBranch.vue側の行自体が担う）。 */
.branch-summary-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 40vh;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin: 8px 12px;
}

.branch-summary-body-expanded {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

/* Changesタブに統合したStash一覧の開閉トグル行。Branchの現在ブランチ行と
   同じ「畳んだ状態が既定・シェブロンで開閉」という語彙に揃える。 */
.stash-summary-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 24px);
  margin: 8px 12px 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
  color: var(--text-secondary);
  font-size: 13px;
  text-align: left;
  flex-shrink: 0;
}

.stash-summary-toggle .mdi {
  font-size: 16px;
  line-height: 1;
}

.stash-summary-toggle-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stash-summary-toggle-expanded {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  color: var(--text-primary);
}

.stash-summary-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 40vh;
  overflow: hidden;
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 var(--radius) var(--radius);
  margin: 0 12px;
  flex-shrink: 0;
}

/* タブバー */
.workspace-tabs {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  gap: 4px;
  padding: 0 8px 0;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  background: transparent;
  scrollbar-width: none;
  border-bottom: 1px solid var(--border);
}

.workspace-tabs::-webkit-scrollbar {
  display: none;
}

.workspace-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 18px;
  background: transparent;
  border: none;
  border-radius: 0;
  color: var(--text-muted);
  font-size: 15px;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  opacity: 0.6;
}

.workspace-tab.active {
  color: var(--text-primary);
  background: var(--accent-bg-12);
  opacity: 1;
}

.workspace-tab .mdi {
  font-size: 20px;
  line-height: 1;
}

.workspace-tab-label {
  line-height: 1;
  max-width: 0;
  margin-left: -6px;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  transition: max-width 0.25s ease, opacity 0.2s ease, margin-left 0.25s ease;
}

.workspace-tab-label-active {
  max-width: 160px;
  margin-left: 0;
  opacity: 1;
}

/* タブコンテンツ */
.workspace-tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@media (max-width: 767px) {
  .workspace-detail {
    flex-direction: column-reverse;
  }

  .workspace-tabs {
    padding: 0 8px;
    /* column-reverse でタブバーは画面下部に来るため、コンテンツとの境界は
       border-bottom（画面最下端になり無意味）ではなく border-top に出す。
       下端は modal-header に直接隣接するため padding は付けない（付けると隙間になる）。 */
    border-bottom: none;
    border-top: 1px solid var(--border);
  }

  .workspace-tab.tab-underline-active::after {
    top: 0;
    bottom: auto;
  }
}
</style>
