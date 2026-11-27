<template>
  <div class="workspace-detail">
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
        <span class="workspace-tab-label" :class="{ 'workspace-tab-label-active': activePane === tab.key }" aria-hidden="true">{{ tab.label }}<span v-if="tab.count && tab.showCount !== false"> ({{ tab.count }})</span></span>
      </button>
    </div>

    <div class="workspace-tab-content pane-fill">
      <div v-show="activePane === 'history'" class="git-history-branch-pane pane-fill">
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
      <div v-show="activePane === 'files'" class="pane-fill">
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
      <div v-if="activePane === 'changes'" class="pane-fill">
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
          <span class="stash-summary-toggle-label text-ellipsis-flex">Stash ({{ stashCount }})</span>
          <span class="mdi" :class="stashSectionExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" aria-hidden="true"></span>
        </button>
        <div v-if="stashSectionExpanded" id="stash-summary-body" class="stash-summary-body">
          <GitStash ref="gitStash" @count="onStashCount" />
        </div>
        <GitChanges ref="gitChanges" />
      </div>
      <div v-if="activePane === 'issues'" class="pane-fill">
        <GitHubIssuesPane ref="githubIssues" @count="issuesCount = $event" />
      </div>
      <div v-if="activePane === 'actions'" class="pane-fill">
        <GitHubActionsPane ref="githubActions" />
      </div>
      <div v-if="activePane === 'docker'" class="pane-fill">
        <DockerPane ref="dockerPane" />
      </div>
      <div v-if="activePane === 'prs'" class="pane-fill">
        <GitHubPRsPane ref="githubPrs" @count="prsCount = $event" />
      </div>
      <div v-if="activePane === 'dispatch'" class="pane-fill">
        <DispatchRunView
          v-if="selectedDispatchId"
          :item-id="selectedDispatchId"
          :preferred-session-id="dispatchPillSessionId"
          @back="selectedDispatchId = null"
          :after-run="onDispatchRunDone"
        />
        <DispatchWorkspacePane v-else @select="selectedDispatchId = $event" />
      </div>
      <div v-show="activePane === 'select'" class="pane-fill">
        <TerminalSelectCopyPane ref="terminalSelectCopyPane" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, nextTick, onMounted } from "vue";
import FileBrowser from "./FileBrowser.vue";
import GitHistory from "./GitHistory.vue";
import GitChanges from "./GitChanges.vue";
import GitChangeBranch from "./GitChangeBranch.vue";
import GitStash from "./GitStash.vue";
import GitHubIssuesPane from "./GitHubIssuesPane.vue";
import GitHubActionsPane from "./GitHubActionsPane.vue";
import DockerPane from "./DockerPane.vue";
import GitHubPRsPane from "./GitHubPRsPane.vue";
import DispatchWorkspacePane from "./DispatchWorkspacePane.vue";
import DispatchRunView from "./DispatchRunView.vue";
import TerminalSelectCopyPane from "./TerminalSelectCopyPane.vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useModalView } from "../composables/useModalView.ts";
import { useWorkspaceCounts } from "../composables/useWorkspaceCounts.ts";
import { useWorkspaceDetailDiff } from "../composables/useWorkspaceDetailDiff.ts";
import { useWorkspaceDetailDispatch } from "../composables/useWorkspaceDetailDispatch.ts";
import { useWorkspaceDetailEvents } from "../composables/useWorkspaceDetailEvents.ts";
import { usePaneLoader } from "../composables/usePaneLoader.ts";
import { useCollapsibleSection } from "../composables/useCollapsibleSection.ts";
import { workspaceDisplayName } from "../utils/worktree.ts";
import { DEFAULT_PANE, paneRequiresGit, resolvePaneKey } from "../utils/workspace-panes.ts";

const workspaceStore = useWorkspaceStore();
const { modalTitle, viewState, modalBranch, updateViewState } = useModalView();
const {
  issuesCount,
  prsCount,
  stashCount,
  changesCount,
  hasGitHub,
  hasBranchPR,
  hasRunningAction,
  hasDocker,
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
const dockerPane = ref<InstanceType<typeof DockerPane> | null>(null);
const githubPrs = ref<InstanceType<typeof GitHubPRsPane> | null>(null);
const terminalSelectCopyPane = ref<InstanceType<typeof TerminalSelectCopyPane> | null>(null);

// Run成功時にワークスペース詳細ごと閉じる（WorkspaceDetailModal.vue が provide）。
const closeWorkspaceDetail = inject<((tabId?: number | null) => void) | undefined>("closeWorkspaceDetail");

const {
  selectedDispatchId,
  dispatchPillSessionId,
  dispatchPendingCount,
  dispatchRecentCount,
  openDispatchItem,
  resetSelection: resetDispatchSelection,
  onDispatchRunDone,
} = useWorkspaceDetailDispatch(closeWorkspaceDetail);

const {
  selectedDiffFile,
  diffMessage,
  selectedDiffIsWorkingTree,
  selectedDiffCommitHash,
  filesBrowsing,
  onFileBrowserState,
  clearDiffSelection,
  selectDiffFile,
} = useWorkspaceDetailDiff();

const activePane = ref(DEFAULT_PANE);
// Branch一覧は畳んだ状態を既定にする（コミット履歴の表示領域を圧迫するため）。
const {
  expanded: branchSectionExpanded,
  toggle: toggleBranchSection,
  expand: expandBranchSection,
} = useCollapsibleSection(loadBranchSection);
// Stash一覧も同様に既定は畳む。
const {
  expanded: stashSectionExpanded,
  toggle: toggleStashSection,
  expand: expandStashSection,
} = useCollapsibleSection(loadStashSection);
// コミットのファイル一覧を見ている間はBranchヘッダーを隠す（GitHistoryのcommit:expanded/collapsed）。
const isViewingCommitFiles = ref(false);

const terminalSessionId = computed(() => viewState!.value?.detail?.terminalSessionId || "");
const fileBrowserRootLabel = computed(() => viewState!.value?.detail?.rootLabel || "");

const isGitWorkspace = computed(() => !terminalSessionId.value && !!workspaceStore.currentWorkspace?.is_git_repo);

// showCount: false のタブは "(件数)" を出さない（アイコンの色だけで知らせる）。
type WorkspaceTabDef = { key: string, icon: string, label: string, count?: number, showCount?: boolean, iconColor?: string, hidden?: boolean };

const tabs = computed(() => {
  const isGit = isGitWorkspace.value;
  const list: WorkspaceTabDef[] = [
    {
      key: "files",
      icon: filesBrowsing.value ? "mdi-folder-open-outline" : "mdi-folder-outline",
      iconColor: "var(--teal)",
      label: "Files",
    },
    { key: "history", icon: "mdi-source-branch", label: "History", iconColor: "var(--success)", hidden: !isGit },
    { key: "changes", icon: "mdi-file-document-multiple-outline", label: "Changes", count: changesCount.value || 0, showCount: false, iconColor: changesCount.value ? "var(--amber)" : undefined, hidden: !isGit },
    { key: "issues", icon: "mdi-ticket-confirmation-outline", label: "Issues", count: issuesCount.value || 0, showCount: false, iconColor: issuesCount.value ? "var(--amber)" : undefined, hidden: !isGit || !hasGitHub.value || !issuesCount.value },
    { key: "prs", icon: "mdi-source-pull", label: "PRs", count: prsCount.value || 0, showCount: false, iconColor: hasBranchPR.value ? "var(--purple)" : undefined, hidden: !isGit || !hasGitHub.value || !prsCount.value },
    { key: "actions", icon: "mdi-cog-play-outline", label: "Actions", iconColor: hasRunningAction.value ? "var(--brown)" : undefined, hidden: !isGit || !hasGitHub.value },
    { key: "docker", icon: "mdi-docker", label: "Docker", iconColor: hasDocker.value ? "var(--docker-blue)" : undefined, hidden: !workspaceStore.currentWorkspace?.has_compose_file },
    { key: "dispatch", icon: "mdi-inbox-arrow-down-outline", label: "Dispatch", iconColor: dispatchPendingCount.value ? "var(--pink)" : undefined, count: dispatchPendingCount.value || 0, hidden: !!terminalSessionId.value || (!dispatchPendingCount.value && !dispatchRecentCount.value) },
    { key: "select", icon: "mdi-content-copy", label: "Select & Copy" },
  ];
  return list.filter((t) => !t.hidden);
});

function updateViewTitle() {
  const ws = workspaceStore.currentWorkspace;
  modalTitle!.value = fileBrowserRootLabel.value || (ws ? workspaceDisplayName(ws) : (workspaceStore.selectedWorkspace || "Git"));
  if (modalBranch) modalBranch.value = "";
}


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

function loadStashSection() {
  nextTick(() => gitStash.value?.load());
}

function handleBack() {
  if (activePane.value === "dispatch" && selectedDispatchId.value) {
    resetDispatchSelection();
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

function open(options: { pane?: string, dispatchItemId?: string, expandBranch?: boolean, sessionId?: string | null, filePath?: string, dirPath?: string } | null | undefined) {
  options = options || {};
  const paneKey = options.pane || DEFAULT_PANE;
  // branchピル経由は Push/Pull 件数がある時だけBranch一覧を展開する。expandBranch省略時（deep link等）は paneKey==="branch" で判定。
  // paneKey==="stash" はChangesタブを開いてStash一覧を展開する。
  const wantBranchExpanded = options.expandBranch ?? (paneKey === "branch");
  const wantStashExpanded = paneKey === "stash";
  let resolvedPane = paneKey;
  if (paneRequiresGit(resolvedPane) && !workspaceStore.currentWorkspace?.is_git_repo) {
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
    resetDispatchSelection();
  });

  switchPane(resolvedPane, {
    expandBranch: wantBranchExpanded,
    expandStash: wantStashExpanded,
    openFilePath: resolvedPane === "files" ? options.filePath : undefined,
    openDirPath: resolvedPane === "files" ? options.dirPath : undefined,
  });
  if (resolvedPane === "dispatch") openDispatchItem(options.dispatchItemId, options.sessionId);
}

type SwitchPaneOpts = { expandBranch?: boolean, expandStash?: boolean, openFilePath?: string, openDirPath?: string };

// ペイン切替時の初期化（issues/actions/docker/prs は v-if + onMounted で自動ロードするためエントリ無し）。
const paneEnterHandlers: Record<string, (opts: SwitchPaneOpts) => void> = {
  history: (opts) => {
    nextTick(() => {
      // commit:expanded/collapsed の取りこぼしでBranchヘッダーが隠れたままになるのを防ぐため、入るたびに実際の状態へ同期する。
      isViewingCommitFiles.value = !!gitHistory.value?.hasExpanded?.();
      paneLoader.ensure("history", workspaceStore.selectedWorkspace, () => gitHistory.value?.load());
      loadBranchSection();
      if (opts.expandBranch) expandBranchSection();
    });
  },
  changes: (opts) => {
    nextTick(() => gitChanges.value?.loadWorkingTreeDiff());
    if (opts.expandStash) expandStashSection();
  },
  files: (opts) => {
    nextTick(() => {
      const filesKey = terminalSessionId.value || workspaceStore.selectedWorkspace;
      if (opts.openFilePath) {
        paneLoader.markLoaded("files", filesKey);
        fileBrowser.value?.openFileAt(opts.openFilePath);
        return;
      }
      if (opts.openDirPath) {
        paneLoader.markLoaded("files", filesKey);
        fileBrowser.value?.navigateToPath(opts.openDirPath);
        return;
      }
      paneLoader.ensure("files", filesKey, () => fileBrowser.value?.load());
    });
  },
  select: () => {
    nextTick(() => terminalSelectCopyPane.value?.refresh());
  },
};

function switchPane(rawKey: string, opts: SwitchPaneOpts = {}) {
  const key = resolvePaneKey(rawKey);
  activePane.value = key;
  updateViewState?.({ detail: { ...(viewState!.value?.detail || {}), pane: key } });
  updateViewTitle();
  paneEnterHandlers[key]?.(opts);
}

function onStashCount(n: number | null) {
  stashCount.value = n;
}

function onCommitCollapsed() {
  isViewingCommitFiles.value = false;
  updateViewTitle();
}

useWorkspaceDetailEvents({
  open,
  switchPane,
  activePane,
  clearDiffSelection,
  selectDiffFile,
  fileBrowser,
  gitHistory,
  paneLoader,
  updateViewTitle,
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


/* Branch一覧は既定で現在のブランチ名+シェブロンの1行に畳む。 */
.git-history-branch-branches {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
  border-bottom: 1px solid var(--border);
}

/* 現在ブランチの行がセレクトボックス先頭項目兼開閉トグルを兼ねるため、ここは外枠の見た目だけを持つ。 */
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

/* Changesタブ内のStash一覧の開閉トグル行。Branchの現在ブランチ行と同じ語彙に揃える。 */
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


@media (max-width: 768px) {
  .workspace-detail {
    flex-direction: column-reverse;
  }

  .workspace-tabs {
    padding: 0 8px;
    /* column-reverse でタブバーが下部に来るため、境界は border-top に出す。下端は modal-header に隣接するため padding は付けない。 */
    border-bottom: none;
    border-top: 1px solid var(--border);
  }

  .workspace-tab.tab-underline-active::after {
    top: 0;
    bottom: auto;
  }
}
</style>
