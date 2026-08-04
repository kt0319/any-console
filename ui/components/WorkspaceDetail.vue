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
        <div class="git-history-branch-branches">
          <div class="branch-summary-header">
            <button
              type="button"
              class="branch-summary-toggle"
              :aria-label="branchSectionExpanded ? 'Collapse branches' : 'Expand branches'"
              :aria-expanded="branchSectionExpanded"
              @click="toggleBranchSection"
            >
              <span class="mdi mdi-source-branch branch-summary-icon"></span>
              <span class="branch-summary-name">{{ workspaceStore.currentWorkspace?.branch || "" }}</span>
            </button>
            <button
              type="button"
              class="branch-summary-chevron-btn"
              :aria-label="branchSectionExpanded ? 'Collapse branches' : 'Expand branches'"
              :aria-expanded="branchSectionExpanded"
              @click="toggleBranchSection"
            >
              <span class="mdi branch-summary-chevron" :class="branchSectionExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
            </button>
          </div>
          <div v-show="branchSectionExpanded" class="branch-summary-body">
            <GitChangeBranch ref="gitBranch" @close="branchSectionExpanded = false" />
          </div>
        </div>
        <GitHistory
          ref="gitHistory"
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
        <GitChanges ref="gitChanges" />
      </div>
      <div v-if="activePane === 'jobs'" class="file-modal-pane">
        <WorkspaceJobsPane ref="jobsPane" />
      </div>
      <div v-if="activePane === 'stash'" class="file-modal-pane">
        <GitStash ref="gitStash" @count="onStashCount" />
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
      <div v-show="activePane === 'select'" class="file-modal-pane">
        <TerminalSelectPane ref="terminalSelectPane" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from "vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitChanges from "./GitChanges.vue";
import GitChangeBranch from "./GitChangeBranch.vue";
import GitStash from "./GitStash.vue";
import WorkspaceJobsPane from "./WorkspaceJobsPane.vue";
import GitHubIssuesPane from "./GitHubIssuesPane.vue";
import GitHubActionsPane from "./GitHubActionsPane.vue";
import GitHubPRsPane from "./GitHubPRsPane.vue";
import TerminalSelectPane from "./TerminalSelectPane.vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useToast } from "../composables/useToast.js";
import { useModalView } from "../composables/useModalView.js";
import { useWorkspaceCounts } from "../composables/useWorkspaceCounts.js";
import { useConfirm } from "../composables/useConfirm.js";
import { workspaceDisplayName } from "../utils/worktree.js";

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

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitChanges = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const githubIssues = ref(null);
const githubActions = ref(null);
const githubPrs = ref(null);
const jobsPane = ref(null);
const terminalSelectPane = ref(null);

const activePane = ref("jobs");
// HistoryタブのBranch一覧は畳んだ状態を既定にし、シェブロンボタンで開閉する
// （常時ブランチ一覧を出すとコミット履歴の表示領域を圧迫するため）。
const branchSectionExpanded = ref(false);
const selectedDiffFile = ref("");
const diffMessage = ref("");
const selectedDiffIsWorkingTree = ref(false);
const selectedDiffCommitHash = ref("");

const fileBrowserDeep = ref(false);
const terminalSessionId = computed(() => viewState.value?.detail?.terminalSessionId || "");
const fileBrowserRootLabel = computed(() => viewState.value?.detail?.rootLabel || "");

function onFileBrowserState({ atRoot, fileOpen }) {
  fileBrowserDeep.value = !atRoot || fileOpen;
}

const filesBrowsing = computed(() => fileBrowserDeep.value || !!selectedDiffFile.value);

const isGitWorkspace = computed(() => !terminalSessionId.value && !!workspaceStore.currentWorkspace?.is_git_repo);

const tabs = computed(() => {
  const isGit = isGitWorkspace.value;
  const list = [
    {
      key: "files",
      icon: filesBrowsing.value ? "mdi-folder-open-outline" : "mdi-folder-outline",
      iconColor: "var(--accent)",
      label: "Files",
    },
    { key: "history", icon: "mdi-history", label: "History", iconColor: "var(--pink)", hidden: !isGit },
    { key: "changes", icon: "mdi-file-document-multiple-outline", label: "Changes", count: changesCount.value || 0, iconColor: "#f5a623", hidden: !isGit },
    { key: "stash", icon: "mdi-package-variant", label: "Stashes", count: stashCount.value || 0, hidden: !isGit || !stashCount.value },
    { key: "issues", icon: "mdi-github", label: "Issues", count: issuesCount.value || 0, hidden: !isGit || !hasGithub.value || !issuesCount.value },
    { key: "prs", icon: "mdi-source-pull", label: "PRs", count: prsCount.value || 0, iconColor: "var(--purple)", hidden: !isGit || !hasGithub.value || !prsCount.value },
    { key: "actions", icon: "mdi-cog-play-outline", label: "Actions", hidden: !isGit || !hasGithub.value },
    { key: "select", icon: "mdi-content-copy", label: "Select & Copy" },
  ];
  return list.filter((t) => !t.hidden);
});

function updateViewTitle() {
  const ws = workspaceStore.currentWorkspace;
  modalTitle.value = fileBrowserRootLabel.value || (ws ? workspaceDisplayName(ws) : (workspaceStore.selectedWorkspace || "Git"));
  if (modalBranch) modalBranch.value = "";
}


let loadedWorkspace = null;
let historyLoadedFor = null;
let filesLoadedFor = null;
let branchLoadedFor = null;

function loadBranchSection() {
  if (branchLoadedFor === workspaceStore.selectedWorkspace) return;
  branchLoadedFor = workspaceStore.selectedWorkspace;
  nextTick(() => {
    gitBranch.value?.load();
    gitBranch.value?.backgroundFetch();
  });
}

function toggleBranchSection() {
  branchSectionExpanded.value = !branchSectionExpanded.value;
  if (branchSectionExpanded.value) loadBranchSection();
}

function clearDiffSelection() {
  selectedDiffFile.value = "";
  diffMessage.value = "";
  selectedDiffIsWorkingTree.value = false;
  selectedDiffCommitHash.value = "";
}

function handleBack() {
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
  const workspaceChanged = filesKey !== loadedWorkspace;
  if (workspaceChanged) {
    historyLoadedFor = null;
    filesLoadedFor = null;
    branchLoadedFor = null;
    branchSectionExpanded.value = false;
    loadedWorkspace = filesKey;
  }

  switchPane(resolvedPane);
}

async function switchPane(key) {
  // 後方互換: "github" → "issues"、"browser"/"branch" → "history"
  // （BranchはHistoryタブへ統合。Branch一覧は常に畳んだ状態で開始する）
  if (key === "github") key = "issues";
  if (key === "browser" || key === "branch") key = "history";

  activePane.value = key;
  updateViewState?.({ detail: { ...(viewState.value?.detail || {}), pane: key } });
  updateViewTitle();

  if (key === "history") {
    nextTick(() => {
      if (historyLoadedFor !== workspaceStore.selectedWorkspace) {
        historyLoadedFor = workspaceStore.selectedWorkspace;
        gitHistory.value?.load();
      }
    });
  } else if (key === "changes") {
    nextTick(() => gitChanges.value?.loadWorkingTreeDiff());
  } else if (key === "stash") {
    nextTick(() => gitStash.value?.load());
  } else if (key === "jobs") {
    nextTick(() => jobsPane.value?.load());
  } else if (key === "files") {
    nextTick(() => {
      const filesKey = terminalSessionId.value || workspaceStore.selectedWorkspace;
      if (filesLoadedFor !== filesKey) {
        filesLoadedFor = filesKey;
        fileBrowser.value?.load();
      }
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
    filesLoadedFor = workspaceStore.selectedWorkspace;
    updateViewTitle();
    nextTick(() => fileBrowser.value?.navigateToPath(path));
  }),

  on("git:commitDone", () => {
    if (activePane.value === "history") {
      gitHistory.value?.reload();
    } else {
      historyLoadedFor = null;
    }
  }),

  on("git:checkoutBranch", async ({ branch, remote }) => {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const { ok } = await apiCommand(wsEndpoint(workspace, "checkout"), { branch, remote }, { errorMessage: "Checkout failed" });
    if (!ok) return;
    workspaceStore.fetchStatuses();
    bridgeEmit("modal:close");
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
  const detail = viewState.value?.detail;
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

.branch-summary-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.branch-summary-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.branch-summary-chevron-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: 4px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .branch-summary-chevron-btn:hover .branch-summary-chevron {
    color: var(--text-primary);
  }
}

.branch-summary-icon {
  color: var(--success);
  font-size: 15px;
  flex-shrink: 0;
}

.branch-summary-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-summary-chevron {
  color: var(--text-muted);
  font-size: 18px;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .branch-summary-toggle:hover {
    background: rgba(130, 170, 255, 0.08);
  }
}

.branch-summary-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 40vh;
  overflow: hidden;
  border-top: 1px solid var(--border);
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
  background: rgba(130, 170, 255, 0.12);
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
