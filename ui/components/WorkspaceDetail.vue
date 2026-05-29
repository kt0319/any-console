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
      <button class="workspace-tab-rss-add" aria-label="Add RSS feed" data-tooltip="Add RSS feed" @click="onRssAddFeed">
        <span class="mdi mdi-plus"></span>
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
        <FileBrowser ref="fileBrowser" :diffFile="selectedDiffFile" :diffMessage="diffMessage" @state="onFileBrowserState" />
      </div>
      <div v-if="activePane === 'changes'" class="file-modal-pane">
        <GitFiles ref="gitFiles" />
      </div>
      <div v-if="activePane === 'branch'" class="file-modal-pane">
        <GitChangeBranch ref="gitBranch" @count="branchCount = $event" />
      </div>
      <div v-if="activePane === 'worktree'" class="file-modal-pane">
        <GitWorktree ref="gitWorktree" @count="worktreeCount = $event" />
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
      <div v-if="activePane.startsWith('rss-')" class="file-modal-pane">
        <RSSPane :key="activePane" :feed="currentRssFeed" @removed="onFeedRemoved" @edit="onFeedEdit" />
      </div>
    </div>

    <!-- RSS追加ダイアログ -->
    <div v-if="rssAddingFeed" class="rss-add-overlay" @click.self="rssAddingFeed = false">
      <div class="rss-add-dialog">
        <div class="rss-add-title">{{ rssEditingFeed ? "Edit Feed" : "Add RSS / Atom Feed" }}</div>
        <input
          ref="rssUrlInput"
          v-model="rssNewFeedUrl"
          class="rss-add-input"
          type="text"
          placeholder="https://example.com/feed.xml"
          @keydown.enter="submitRssAddFeed"
          @keydown.esc="rssAddingFeed = false"
        />
        <input
          ref="rssTitleInput"
          v-model="rssNewFeedTitle"
          class="rss-add-input"
          type="text"
          placeholder="Name (optional)"
          @keydown.enter="submitRssAddFeed"
          @keydown.esc="rssAddingFeed = false"
        />
        <div v-if="rssAddError" class="rss-add-error">{{ rssAddError }}</div>
        <div class="rss-add-actions">
          <button class="rss-btn rss-btn-cancel" @click="rssAddingFeed = false">Cancel</button>
          <button class="rss-btn rss-btn-ok" :disabled="rssAddSubmitting" @click="submitRssAddFeed">
            {{ rssAddSubmitting ? "Saving..." : (rssEditingFeed ? "Save" : "Add") }}
          </button>
        </div>
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
import GitWorktree from "./GitWorktree.vue";
import GitStash from "./GitStash.vue";
import WorkspaceJobsPane from "./WorkspaceJobsPane.vue";
import GitHubIssuesPane from "./GitHubIssuesPane.vue";
import GitHubActionsPane from "./GitHubActionsPane.vue";
import GitHubPRsPane from "./GitHubPRsPane.vue";
import RSSPane from "./RSSPane.vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useToast } from "../composables/useToast.js";
import { useModalView } from "../composables/useModalView.js";
import { getCachedCount, useGitHub } from "../composables/useGitHub.js";
import { getStashCachedCount, setStashCache } from "../composables/useStashCache.js";
import { useRSS, isToday } from "../composables/useRSS.js";
import { useConfirm } from "../composables/useConfirm.js";
import { RSS_AUTO_REFRESH_MS } from "../utils/constants.js";

const workspaceStore = useWorkspaceStore();
const { apiCommand, apiGet, wsEndpoint } = useApi();
const toast = useToast();
const { confirm } = useConfirm();
const { loadWorkspaceGithubUrl, loadIssues, loadPRs } = useGitHub();
const { modalTitle, viewState } = useModalView();
const { loadFeeds, loadItems, addFeed, removeFeed, updateFeed } = useRSS();

const fileBrowser = ref(null);
const gitHistory = ref(null);
const gitFiles = ref(null);
const gitBranch = ref(null);
const gitWorktree = ref(null);
const gitStash = ref(null);
const githubIssues = ref(null);
const githubActions = ref(null);
const githubPrs = ref(null);
const jobsPane = ref(null);

const activePane = ref("jobs");
const selectedDiffFile = ref("");
const diffMessage = ref("");

const changesCount = computed(() => {
  const ws = workspaceStore.currentWorkspace;
  if (!ws || ws.clean !== false) return 0;
  return ws.changed_files || 0;
});

const issuesCount = ref(null);
const prsCount = ref(null);
const stashCount = ref(null);
const branchCount = ref(null);
const worktreeCount = ref(null);
const fileBrowserDeep = ref(false);
const historyExpanded = ref(false);

// RSS state
const rssFeeds = ref([]);
const rssNewItemCounts = ref({});
const rssAddingFeed = ref(false);
const rssEditingFeed = ref(null);
const rssNewFeedUrl = ref("");
const rssNewFeedTitle = ref("");
const rssAddError = ref("");
const rssAddSubmitting = ref(false);
const rssUrlInput = ref(null);
const rssTitleInput = ref(null);

function onFileBrowserState({ atRoot, fileOpen }) {
  fileBrowserDeep.value = !atRoot || fileOpen;
}

const filesBrowsing = computed(() => fileBrowserDeep.value || !!selectedDiffFile.value);

const hasGithub = computed(() => !!workspaceStore.currentWorkspace?.github_url);

function rssLabel(feed) {
  if (feed.title) return feed.title;
  try { return new URL(feed.url).hostname; } catch { return feed.url; }
}

const currentRssFeed = computed(() => {
  if (!activePane.value.startsWith("rss-")) return null;
  const id = activePane.value.slice(4);
  return rssFeeds.value.find((f) => f.id === id) || null;
});

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
    { key: "branch", icon: "mdi-source-branch", label: "Branches", count: branchCount.value || 0 },
    { key: "worktree", icon: "mdi-file-tree", label: "Worktrees", count: worktreeCount.value || 0 },
    { key: "stash", icon: "mdi-package-variant", label: "Stashes", count: stashCount.value || 0, hidden: !stashCount.value },
    { key: "issues", icon: "mdi-github", label: "Issues", count: issuesCount.value || 0, hidden: !hasGithub.value || !issuesCount.value },
    { key: "actions", icon: "mdi-github", label: "Actions", hidden: !hasGithub.value },
    { key: "prs", icon: "mdi-github", label: "PRs", count: prsCount.value || 0, hidden: !hasGithub.value || !prsCount.value },
    ...rssFeeds.value.map((f) => ({
      key: `rss-${f.id}`,
      icon: "mdi-rss",
      label: rssLabel(f),
      count: rssNewItemCounts.value[f.id] || 0,
    })),
  ];
  return list.filter((t) => !t.hidden);
});

function updateViewTitle() {
  modalTitle.value = workspaceStore.selectedWorkspace || "Git";
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

async function loadRssFeeds() {
  const loading = ref(false);
  const error = ref("");
  await loadFeeds(rssFeeds, loading, error);
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
    rssNewItemCounts.value = {};
    // History(git-log) / Files は表示ペインを開いた時に遅延ロードする。
    historyLoadedFor = null;
    filesLoadedFor = null;
  }
  loadRssFeeds().then(() => checkRssUpdates());

  if (workspaceChanged) {
    loadedWorkspace = workspace;
  }

  switchPane(resolvedPane);
}

async function switchPane(key) {
  // 後方互換: "github" → "issues"、"browser" → "history"
  if (key === "github") key = "issues";
  if (key === "browser") key = "history";

  activePane.value = key;
  updateViewTitle();

  if (key === "history") {
    // GitHistory は v-show で常時マウント済み。表示時に未ロードならロード（git-log の無駄打ち防止）
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
  } else if (key === "worktree") {
    nextTick(() => gitWorktree.value?.load());
  } else if (key === "stash") {
    nextTick(() => gitStash.value?.load());
  } else if (key === "jobs") {
    nextTick(() => jobsPane.value?.load());
  } else if (key === "files") {
    // FileBrowser は v-show で常時マウント済み。表示時に未ロードならロード
    nextTick(() => {
      if (filesLoadedFor !== workspaceStore.selectedWorkspace) {
        filesLoadedFor = workspaceStore.selectedWorkspace;
        fileBrowser.value?.load();
      }
    });
  }
  // issues/actions/prs/rss-* は v-if + onMounted で自動ロード
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

async function onRssAddFeed() {
  rssEditingFeed.value = null;
  rssNewFeedUrl.value = "";
  rssNewFeedTitle.value = "";
  rssAddError.value = "";
  rssAddingFeed.value = true;
  await nextTick();
  rssUrlInput.value?.focus();
}

async function onFeedEdit(feed) {
  rssEditingFeed.value = feed;
  rssNewFeedUrl.value = feed.url || "";
  rssNewFeedTitle.value = feed.title || "";
  rssAddError.value = "";
  rssAddingFeed.value = true;
  await nextTick();
  rssUrlInput.value?.select();
}

async function submitRssAddFeed() {
  if (rssAddSubmitting.value) return;
  rssAddSubmitting.value = true;
  rssAddError.value = "";

  if (rssEditingFeed.value) {
    const url = rssNewFeedUrl.value.trim();
    if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
      rssAddError.value = "Invalid URL";
      rssAddSubmitting.value = false;
      return;
    }
    const ok = await updateFeed(rssEditingFeed.value.id, { url, title: rssNewFeedTitle.value.trim() });
    rssAddSubmitting.value = false;
    if (!ok) {
      rssAddError.value = "Failed to save";
      return;
    }
    rssAddingFeed.value = false;
    rssEditingFeed.value = null;
    await loadRssFeeds();
    return;
  }

  if (!rssNewFeedUrl.value.trim()) {
    rssAddSubmitting.value = false;
    return;
  }
  const result = await addFeed(rssNewFeedUrl.value.trim(), rssNewFeedTitle.value.trim());
  rssAddSubmitting.value = false;
  if (!result.ok) {
    rssAddError.value = result.detail;
    return;
  }
  rssAddingFeed.value = false;
  await loadRssFeeds();
  if (result.feed) {
    await nextTick();
    switchPane(`rss-${result.feed.id}`);
  }
}

async function checkRssUpdates() {
  if (!rssFeeds.value.length) return;
  const tempItems = ref([]);
  const tempLoading = ref(false);
  const tempError = ref("");
  await loadItems(tempItems, tempLoading, tempError, null);
  if (tempError.value) return;

  const counts = {};
  for (const item of tempItems.value) {
    if (isToday(item.date)) {
      counts[item.feed_id] = (counts[item.feed_id] || 0) + 1;
    }
  }
  rssNewItemCounts.value = counts;
}

let _rssBgTimer = null;

async function onFeedRemoved(feedId) {
  const feed = rssFeeds.value.find((f) => f.id === feedId);
  const label = feed?.title || feed?.url || feedId;
  if (!await confirm(`Remove feed "${label}"? This cannot be undone.`)) return;
  await removeFeed(feedId);
  if (activePane.value === `rss-${feedId}`) {
    switchPane("jobs");
  }
  await loadRssFeeds();
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
    filesLoadedFor = workspaceStore.selectedWorkspace;
    updateViewTitle();
    nextTick(() => fileBrowser.value?.navigateToPath(path));
  }),

  on("git:commitDone", () => {
    // History を表示中なら再取得、そうでなければ次に開いた時に再取得させる。
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

onMounted(() => {
  _rssBgTimer = setInterval(checkRssUpdates, RSS_AUTO_REFRESH_MS);
});

onUnmounted(() => {
  _offHandlers.forEach((off) => off());
  clearInterval(_rssBgTimer);
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

.workspace-tab-rss-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: 1px solid var(--border);
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  align-self: center;
  margin-left: 4px;
}

.workspace-tab-rss-add .mdi {
  font-size: 16px;
  line-height: 1;
}

@media (hover: hover) and (pointer: fine) {
  .workspace-tab-rss-add:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
}

/* タブコンテンツ */
.workspace-tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* RSS追加ダイアログ */
.rss-add-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.rss-add-dialog {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  width: min(320px, 90%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rss-add-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.rss-add-input {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 13px;
  padding: 8px 10px;
  width: 100%;
  box-sizing: border-box;
}

.rss-add-input:focus {
  outline: none;
  border-color: var(--accent);
}

.rss-add-error {
  font-size: 12px;
  color: var(--error);
}

.rss-add-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.rss-btn {
  font-size: 13px;
  padding: 6px 16px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 1px solid var(--border);
}

.rss-btn-cancel {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.rss-btn-ok {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.rss-btn-ok:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

  .workspace-tab-rss-add {
    border-radius: 0 0 var(--radius) var(--radius);
  }
}
</style>
