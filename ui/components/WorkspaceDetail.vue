<template>
  <div class="workspace-detail">
    <div v-show="topRatio > 0" class="workspace-detail-top" :style="{ flex: topRatio + ' 1 0%' }">
      <!-- タブバー -->
      <div class="workspace-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="workspace-tab"
          :class="{ active: activePane === tab.key }"
          @click="switchPane(tab.key)"
        >
          <span :class="['mdi', tab.icon]"></span>
          <span class="workspace-tab-label">{{ tab.label }}</span>
          <span v-if="tab.badge" class="workspace-tab-badge">{{ tab.badge }}</span>
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
        <div v-if="activePane === 'changes'" class="file-modal-pane">
          <GitFiles ref="gitFiles" />
        </div>
        <div v-if="activePane === 'branch'" class="file-modal-pane">
          <GitChangeBranch ref="gitBranch" />
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
      <GitCommitForm ref="commitForm" />
    </div>

    <div
      class="workspace-detail-handle"
      @mousedown="onHandlePointerDown"
      @touchstart.prevent="onHandlePointerDown"
    >
      <span class="handle-line"></span>
      <span class="handle-grip mdi mdi-drag-horizontal"></span>
      <span class="handle-line"></span>
    </div>

    <div v-show="topRatio < 1" class="workspace-detail-bottom" :style="{ flex: (1 - topRatio) + ' 1 0%' }">
      <div class="file-modal-pane">
        <FileBrowser ref="fileBrowser" :diffFile="selectedDiffFile" :diffMessage="diffMessage" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, watch } from "vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitFiles from "./GitFiles.vue";
import GitChangeBranch from "./GitChangeBranch.vue";
import GitStash from "./GitStash.vue";
import GitCommitForm from "./GitCommitForm.vue";
import GitHubIssuesPane from "./GitHubIssuesPane.vue";
import GitHubActionsPane from "./GitHubActionsPane.vue";
import GitHubPRsPane from "./GitHubPRsPane.vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { getCachedCount, useGitHub } from "../composables/useGitHub.js";
import { getStashCachedCount, setStashCache } from "../composables/useStashCache.js";
import { useResizeHandle } from "../composables/useResizeHandle.js";

const workspaceStore = useWorkspaceStore();
const { apiCommand, apiGet, wsEndpoint } = useApi();
const { loadWorkspaceGithubUrl, loadIssues, loadPRs } = useGitHub();
const { modalTitle, viewState } = useModalView();

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitFiles = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const commitForm = ref(null);
const githubIssues = ref(null);
const githubActions = ref(null);
const githubPrs = ref(null);

const activePane = ref("history");
const { topRatio, onHandlePointerDown } = useResizeHandle(0.33);
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

const hasGithub = computed(() => !!workspaceStore.currentWorkspace?.github_url);

const tabs = computed(() => {
  const list = [
    { key: "history", icon: "mdi-history", label: "History" },
    { key: "changes", icon: "mdi-file-document-multiple-outline", label: "Changes", badge: changesCount.value || "" },
    { key: "branch", icon: "mdi-source-branch", label: "Branch" },
    { key: "stash", icon: "mdi-package-variant", label: "Stash", badge: stashCount.value || "", hidden: !stashCount.value },
    { key: "issues", icon: "mdi-github", label: "Issues", badge: issuesCount.value || "", hidden: !hasGithub.value || !issuesCount.value },
    { key: "actions", icon: "mdi-github", label: "Actions", hidden: !hasGithub.value },
    { key: "prs", icon: "mdi-github", label: "PR", badge: prsCount.value || "", hidden: !hasGithub.value || !prsCount.value },
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

async function open(options) {
  options = options || {};
  const paneKey = options.pane || "history";
  activePane.value = paneKey === "browser" ? "history" : paneKey;
  selectedDiffFile.value = "";
  diffMessage.value = "";
  updateViewTitle();

  const workspace = workspaceStore.selectedWorkspace;
  issuesCount.value = getCachedCount(workspace, "issues");
  prsCount.value = getCachedCount(workspace, "prs");
  stashCount.value = getStashCachedCount(workspace);

  backgroundLoadCounts(workspace);

  if (workspace !== loadedWorkspace) {
    loadedWorkspace = workspace;
    await gitHistory.value?.load();
  } else {
    gitHistory.value?.reload();
  }

  fileBrowser.value?.load();
}

async function switchPane(key) {
  // 後方互換: "github" → "issues"、"browser" → "history"
  if (key === "github") key = "issues";
  if (key === "browser") key = "history";

  activePane.value = key;
  selectedDiffFile.value = "";
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
  }
  // issues/actions/prs は v-if + onMounted で自動ロード
}

function onStashCount(n) {
  stashCount.value = n;
}

function onCommitExpanded() {
}

function onCommitCollapsed() {
  updateViewTitle();
}

on("git:selectDirty", () => {
  selectedDiffFile.value = "";
  diffMessage.value = "";
});

on("git:selectDiffFile", ({ path }) => {
  selectedDiffFile.value = path;
  topRatio.value = 0.33;
  diffMessage.value = "";
});

on("git:openCommitForm", () => {
  commitForm.value?.open();
});

on("git:commitDone", () => {
  commitForm.value?.close();
  gitHistory.value?.reload();
});

on("git:checkoutBranch", async ({ branch, remote }) => {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "checkout"), { branch, remote }, { errorMessage: "Checkout failed" });
  if (!ok) return;
  switchPane("history");
  workspaceStore.fetchStatuses();
  gitHistory.value?.reload();
  fileBrowser.value?.load();
});

on("git:stashSave", async () => {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true }, { errorMessage: "Stash save failed" });
  if (!ok) return;
  gitHistory.value?.reload();
});

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

.workspace-detail-top {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workspace-detail-bottom {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workspace-detail-handle {
  display: flex;
  align-items: center;
  padding: 6px 0;
  flex-shrink: 0;
  cursor: row-resize;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.handle-line {
  flex: 1;
  height: 1px;
  background: var(--border);
}

.handle-grip {
  flex-shrink: 0;
  padding: 0 24px;
  font-size: 20px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  line-height: 1;
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
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  border-bottom: 1px solid var(--border);
  background: var(--bg-primary);
  scrollbar-width: none;
}

.workspace-tabs::-webkit-scrollbar {
  display: none;
}

.workspace-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  min-width: 52px;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  border-radius: 0;
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
}

.workspace-tab.active {
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-bottom-color: var(--accent);
}


.workspace-tab .mdi {
  font-size: 17px;
  line-height: 1;
}

.workspace-tab-label {
  line-height: 1;
}

.workspace-tab-badge {
  position: absolute;
  top: 4px;
  right: 6px;
  background: var(--accent);
  color: var(--bg-primary);
  font-size: 9px;
  font-weight: 600;
  border-radius: 8px;
  padding: 0 4px;
  min-width: 14px;
  text-align: center;
  line-height: 14px;
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
  background: var(--bg-secondary);
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
</style>
