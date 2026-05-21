<template>
  <div class="workspace-detail">
    <!-- タブバー -->
    <div class="workspace-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="workspace-tab"
        :class="{ active: activePane === tab.key }"
        @click="switchPane(tab.key)"
      >
        <span :class="['mdi', tab.icon]" :style="tab.iconColor ? { color: tab.iconColor } : null"></span>
        <span class="workspace-tab-label">{{ tab.label }}<span v-if="tab.count"> ({{ tab.count }})</span></span>
      </button>
    </div>

    <!-- ブランチ情報バー -->
    <div v-if="currentBranch" class="workspace-branch-bar">
      <span class="mdi mdi-source-branch workspace-branch-icon"></span>
      <span class="workspace-branch-name">{{ currentBranch }}</span>
      <span v-if="isDirty" class="workspace-branch-dirty" v-html="dirtySummaryHtml"></span>
    </div>

    <!-- タブコンテンツ -->
    <div class="workspace-tab-content">
      <div v-show="activePane === 'history'" class="file-modal-pane">
        <GitHistory
          ref="gitHistory"
          @commit:expanded="onCommitExpanded"
          @commit:collapsed="onCommitCollapsed"
        />
      </div>
      <div v-show="activePane === 'files'" class="file-modal-pane">
        <FileBrowser ref="fileBrowser" :diffFile="selectedDiffFile" :diffMessage="diffMessage" @state="onFileBrowserState" />
      </div>
      <div v-if="activePane === 'changes'" class="file-modal-pane">
        <GitFiles ref="gitFiles" />
      </div>
      <div v-if="activePane === 'branch'" class="file-modal-pane">
        <GitChangeBranch ref="gitBranch" @count="branchCount = $event" />
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from "vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitFiles from "./GitFiles.vue";
import GitChangeBranch from "./GitChangeBranch.vue";
import GitStash from "./GitStash.vue";
import WorkspaceJobsPane from "./WorkspaceJobsPane.vue";
import GitHubIssuesPane from "./GitHubIssuesPane.vue";
import GitHubActionsPane from "./GitHubActionsPane.vue";
import GitHubPRsPane from "./GitHubPRsPane.vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { getCachedCount, useGitHub } from "../composables/useGitHub.js";
import { getStashCachedCount, setStashCache } from "../composables/useStashCache.js";

const workspaceStore = useWorkspaceStore();
const { apiCommand, apiGet, wsEndpoint } = useApi();
const { loadWorkspaceGithubUrl, loadIssues, loadPRs } = useGitHub();
const { modalTitle, viewState } = useModalView();

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitFiles = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const githubIssues = ref(null);
const githubActions = ref(null);
const githubPrs = ref(null);
const jobsPane = ref(null);

const activePane = ref("jobs");
const selectedDiffFile = ref("");
const diffMessage = ref("");

const currentBranch = computed(() => workspaceStore.currentWorkspace?.branch || "");
const isDirty = computed(() => workspaceStore.currentWorkspace?.clean === false);
const changesCount = computed(() => {
  const ws = workspaceStore.currentWorkspace;
  if (!ws || ws.clean !== false) return 0;
  return ws.changed_files || 0;
});
const dirtySummaryHtml = computed(() => {
  const ws = workspaceStore.currentWorkspace;
  if (!ws || ws.clean !== false) return "";
  const files = ws.changed_files || 0;
  const ins = ws.insertions || 0;
  const del = ws.deletions || 0;
  const filePart = files > 0 ? `<span class="branch-bar-files">${files}F</span>` : "";
  return `${filePart}<span class="branch-bar-ins">+${ins}</span><span class="branch-bar-del">-${del}</span>`;
});

const issuesCount = ref(null);
const prsCount = ref(null);
const stashCount = ref(null);
const branchCount = ref(null);
const fileBrowserDeep = ref(false);
const historyExpanded = ref(false);

function onFileBrowserState({ atRoot, fileOpen }) {
  fileBrowserDeep.value = !atRoot || fileOpen;
}

const filesBrowsing = computed(() => fileBrowserDeep.value || !!selectedDiffFile.value);

const hasGithub = computed(() => !!workspaceStore.currentWorkspace?.github_url);

const tabs = computed(() => {
  const list = [
    { key: "jobs", icon: "mdi-play-circle-outline", label: "Jobs" },
    {
      key: "files",
      icon: filesBrowsing.value ? "mdi-folder-open-outline" : "mdi-folder-outline",
      iconColor: filesBrowsing.value ? "var(--accent)" : "",
      label: "Files",
    },
    { key: "history", icon: "mdi-history", label: "History", iconColor: historyExpanded.value ? "var(--accent)" : "" },
    { key: "changes", icon: "mdi-file-document-multiple-outline", label: "Changes", count: changesCount.value || 0 },
    { key: "branch", icon: "mdi-source-branch", label: "Branch", count: branchCount.value || 0 },
    { key: "stash", icon: "mdi-package-variant", label: "Stash", count: stashCount.value || 0, hidden: !stashCount.value },
    { key: "issues", icon: "mdi-github", label: "Issues", count: issuesCount.value || 0, hidden: !hasGithub.value || !issuesCount.value },
    { key: "actions", icon: "mdi-github", label: "Actions", hidden: !hasGithub.value },
    { key: "prs", icon: "mdi-github", label: "PR", count: prsCount.value || 0, hidden: !hasGithub.value || !prsCount.value },
  ];
  return list.filter((t) => !t.hidden);
});

function updateViewTitle() {
  modalTitle.value = workspaceStore.selectedWorkspace || "Git";
}


let loadedWorkspace = null;

function handleBack() {
  if (activePane.value === "history" && gitHistory.value?.hasExpanded?.()) {
    gitHistory.value?.closeExpanded?.();
    selectedDiffFile.value = "";
    diffMessage.value = "";
    updateViewTitle();
    return true;
  }
  if (selectedDiffFile.value) {
    selectedDiffFile.value = "";
    diffMessage.value = "";
    return true;
  }
  return false;
}

async function backgroundLoadCounts(workspace) {
  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, "stash-list"));
    if (ok) {
      const entries = data.entries || [];
      stashCount.value = entries.length;
      setStashCache(workspace, entries);
    }
  } catch {}

  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, "branches"));
    if (ok) branchCount.value = (data || []).filter((b) => !b.remote).length;
  } catch {}

  if (!hasGithub.value) return;
  loadWorkspaceGithubUrl();
  const issueItems = ref([]), issueLoading = ref(false), issueError = ref("");
  const prItems = ref([]), prLoading = ref(false), prError = ref("");
  await Promise.all([
    loadIssues(issueItems, issueLoading, issueError),
    loadPRs(prItems, prLoading, prError),
  ]);
  if (!issueError.value) issuesCount.value = issueItems.value.length;
  if (!prError.value) prsCount.value = prItems.value.length;
}

function open(options) {
  options = options || {};
  const paneKey = options.pane || "jobs";
  const resolvedPane = paneKey === "browser" ? "history" : paneKey;
  selectedDiffFile.value = "";
  diffMessage.value = "";
  updateViewTitle();

  const workspace = workspaceStore.selectedWorkspace;
  issuesCount.value = getCachedCount(workspace, "issues");
  prsCount.value = getCachedCount(workspace, "prs");
  stashCount.value = getStashCachedCount(workspace);

  backgroundLoadCounts(workspace);

  const workspaceChanged = workspace !== loadedWorkspace;
  if (workspaceChanged) {
    loadedWorkspace = workspace;
    gitHistory.value?.load();
  } else {
    gitHistory.value?.reload();
  }

  if (workspaceChanged) fileBrowser.value?.load();
  switchPane(resolvedPane);
}

async function switchPane(key) {
  // 後方互換: "github" → "issues"、"browser" → "history"
  if (key === "github") key = "issues";
  if (key === "browser") key = "history";

  activePane.value = key;
  updateViewTitle();

  if (key === "history") {
    // GitHistory は v-show で常時マウント済み
  } else if (key === "changes") {
    nextTick(() => gitFiles.value?.loadWorkingTreeDiff());
  } else if (key === "branch") {
    nextTick(() => {
      gitBranch.value?.load();
      gitBranch.value?.backgroundFetch();
    });
  } else if (key === "stash") {
    nextTick(() => gitStash.value?.load());
  } else if (key === "jobs") {
    nextTick(() => jobsPane.value?.load());
  } else if (key === "files") {
    // FileBrowser は v-show で常時マウント済み。open() のワークスペース変更時のみロード
  }
  // issues/actions/prs は v-if + onMounted で自動ロード
}

function onStashCount(n) {
  stashCount.value = n;
}

function onCommitExpanded() {
  historyExpanded.value = true;
}

function onCommitCollapsed() {
  historyExpanded.value = false;
  updateViewTitle();
}

const _offHandlers = [
  on("git:selectDirty", () => {
    selectedDiffFile.value = "";
    diffMessage.value = "";
  }),

  on("git:selectDiffFile", ({ path }) => {
    switchPane("files");
    selectedDiffFile.value = path;
    diffMessage.value = "";
  }),

  on("git:browseToFolder", ({ path }) => {
    activePane.value = "files";
    selectedDiffFile.value = "";
    diffMessage.value = "";
    updateViewTitle();
    nextTick(() => fileBrowser.value?.navigateToPath(path));
  }),

  on("git:commitDone", () => {
    gitHistory.value?.reload();
  }),

  on("git:checkoutBranch", async ({ branch, remote }) => {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const { ok } = await apiCommand(wsEndpoint(workspace, "checkout"), { branch, remote }, { errorMessage: "Checkout failed" });
    if (!ok) return;
    switchPane("history");
    workspaceStore.fetchStatuses();
    gitHistory.value?.reload();
    fileBrowser.value?.load();
  }),

  on("git:stashSave", async () => {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const { ok } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true }, { errorMessage: "Stash save failed" });
    if (!ok) return;
    gitHistory.value?.reload();
  }),
];

onUnmounted(() => _offHandlers.forEach((off) => off()));

defineExpose({ handleBack });

watch(() => workspaceStore.currentWorkspace?.branch, () => {
  updateViewTitle();
});

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
}

.file-modal-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* タブバー */
.workspace-tabs {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  gap: 2px;
  padding: 4px 8px 0;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  background: transparent;
  scrollbar-width: none;
}

.workspace-tabs::-webkit-scrollbar {
  display: none;
}

.workspace-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--radius) var(--radius) 0 0;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
}

.workspace-tab.active {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
}

.workspace-tab .mdi {
  font-size: 16px;
  line-height: 1;
}

.workspace-tab-label {
  line-height: 1;
}



/* タブコンテンツ */
.workspace-tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ブランチ情報バー */
.workspace-branch-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--bg-secondary) 70%, transparent);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
}

.workspace-branch-icon {
  font-size: 13px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.workspace-branch-name {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.workspace-branch-dirty {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  margin-left: auto;
}

.workspace-branch-dirty :deep(.branch-bar-files) {
  color: var(--warning);
}

.workspace-branch-dirty :deep(.branch-bar-ins) {
  color: var(--success);
}

.workspace-branch-dirty :deep(.branch-bar-del) {
  color: var(--error);
}

@media (max-width: 767px) {
  .workspace-detail {
    flex-direction: column-reverse;
  }

  .workspace-tabs {
    padding: 0 8px 4px;
  }

  .workspace-tab {
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .workspace-branch-bar {
    border-bottom: none;
    border-top: 1px solid var(--border);
  }
}
</style>
