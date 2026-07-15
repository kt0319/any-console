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
        <FileBrowser
          ref="fileBrowser"
          :diffFile="selectedDiffFile"
          :diffMessage="diffMessage"
          :rootLabel="fileBrowserRootLabel"
          :terminalSessionId="terminalSessionId"
          @state="onFileBrowserState"
        />
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
import GitFiles from "./GitFiles.vue";
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
  branchCount,
  changesCount,
  hasGithub,
  primeFromCache,
  loadCounts,
} = useWorkspaceCounts();

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitFiles = ref(null);
const gitBranch = ref(null);
const gitStash = ref(null);
const githubIssues = ref(null);
const githubActions = ref(null);
const githubPrs = ref(null);
const jobsPane = ref(null);
const terminalSelectPane = ref(null);

const activePane = ref("jobs");
const selectedDiffFile = ref("");
const diffMessage = ref("");

const fileBrowserDeep = ref(false);
const historyExpanded = ref(false);
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
    { key: "jobs", icon: "mdi-play-circle-outline", label: "Jobs", hidden: !isGit },
    {
      key: "files",
      icon: filesBrowsing.value ? "mdi-folder-open-outline" : "mdi-folder-outline",
      iconColor: filesBrowsing.value ? "var(--accent)" : "",
      label: "Files",
    },
    { key: "history", icon: "mdi-history", label: "History", iconColor: historyExpanded.value ? "var(--accent)" : "", hidden: !isGit },
    { key: "changes", icon: "mdi-file-document-multiple-outline", label: "Changes", count: changesCount.value || 0, iconColor: changesCount.value ? "var(--accent)" : "", hidden: !isGit },
    { key: "branch", icon: "mdi-source-branch", label: "Branches", count: branchCount.value || 0, hidden: !isGit },
    { key: "stash", icon: "mdi-package-variant", label: "Stashes", count: stashCount.value || 0, hidden: !isGit || !stashCount.value },
    { key: "issues", icon: "mdi-github", label: "Issues", count: issuesCount.value || 0, hidden: !isGit || !hasGithub.value || !issuesCount.value },
    { key: "actions", icon: "mdi-github", label: "Actions", hidden: !isGit || !hasGithub.value },
    { key: "prs", icon: "mdi-github", label: "PRs", count: prsCount.value || 0, hidden: !isGit || !hasGithub.value || !prsCount.value },
    { key: "select", icon: "mdi-content-copy", label: "Select & Copy" },
  ];
  return list.filter((t) => !t.hidden);
});

function updateViewTitle() {
  const ws = workspaceStore.currentWorkspace;
  modalTitle.value = fileBrowserRootLabel.value || (ws ? workspaceDisplayName(ws) : (workspaceStore.selectedWorkspace || "Git"));
  if (modalBranch) modalBranch.value = terminalSessionId.value ? "" : (ws?.branch || "");
}


let loadedWorkspace = null;
let historyLoadedFor = null;
let filesLoadedFor = null;

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

function open(options) {
  options = options || {};
  const paneKey = options.pane || "jobs";
  let resolvedPane = paneKey === "browser" ? "history" : paneKey;
  // 非 git ワークスペースで git 専用ペインが指定された場合は files にフォールバック
  const gitOnlyPanes = new Set(["jobs", "history", "changes", "branch", "stash", "issues", "actions", "prs"]);
  if (gitOnlyPanes.has(resolvedPane) && !workspaceStore.currentWorkspace?.is_git_repo) {
    resolvedPane = "files";
  }
  selectedDiffFile.value = "";
  diffMessage.value = "";
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
    loadedWorkspace = filesKey;
  }

  switchPane(resolvedPane);
}

async function switchPane(key) {
  // 後方互換: "github" → "issues"、"browser" → "history"
  if (key === "github") key = "issues";
  if (key === "browser") key = "history";

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

function onCommitExpanded() {
  historyExpanded.value = true;
}

function onCommitCollapsed() {
  historyExpanded.value = false;
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
  border-bottom: 1px solid var(--border);
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
}
</style>
