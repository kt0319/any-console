<template>
  <div class="workspace-status-bar" :style="{ display: showHeader ? 'flex' : 'none' }">
    <template v-if="workspace">
      <div class="status-nav-group">
        <template v-if="!isMobile">
          <button type="button" class="status-nav-btn" aria-label="Jobs" data-tooltip="Jobs" @click="openFileModal('jobs')">
            <span class="mdi mdi-play-circle-outline status-btn-icon" aria-hidden="true"></span>
            <span class="status-btn-label" :class="{ 'status-btn-label-always': !isBranchLong }">Jobs</span>
          </button>
          <div class="status-divider"></div>
          <button type="button" class="status-nav-btn" aria-label="Files" data-tooltip="Files" @click="openFileModal('files')">
            <span class="mdi mdi-folder-outline status-btn-icon" aria-hidden="true"></span>
            <span class="status-btn-label" :class="{ 'status-btn-label-always': !isBranchLong }">Files</span>
          </button>
        </template>
        <template v-if="isGitRepo">
          <div v-if="!isMobile" class="status-divider"></div>
          <button type="button" class="status-nav-btn status-msg-btn" tabindex="-1" aria-label="History" data-tooltip="History" @click="openFileModal('history')">
            <span class="mdi mdi-history status-btn-icon" aria-hidden="true"></span>
            <span class="status-msg-text" :class="{ 'status-msg-loading': statusLoading }">{{ msgText }}</span>
          </button>
          <template v-if="!isMobile || isDirty">
            <div class="status-divider"></div>
            <button type="button" class="status-nav-btn status-numstat-btn" tabindex="-1" aria-label="Changes" data-tooltip="Changes" @click="openFileModal('changes')">
              <span class="mdi mdi-file-document-multiple-outline status-btn-icon" aria-hidden="true"></span>
              <span v-if="!isDirty || statusLoading" class="status-btn-label" :class="{ 'status-btn-label-always': !isBranchLong }">Changes</span>
              <template v-if="isDirty && !statusLoading">
                <span v-if="changedFiles > 0" class="numstat-files">{{ changedFiles }}F</span>
                <span class="diff-num-plus">+{{ insertions }}</span>
                <span class="diff-num-del">-{{ deletions }}</span>
              </template>
            </button>
          </template>
          <div class="status-divider"></div>
          <button type="button" class="status-nav-btn status-branch-btn" tabindex="-1" aria-label="Branches" data-tooltip="Branches" @click="openFileModal('branch')">
            <span class="mdi mdi-source-branch status-btn-icon" aria-hidden="true"></span>
            <span class="status-branch-text"><span v-if="branchParts.abbr" class="branch-abbr">{{ branchParts.abbr }}</span>{{ branchParts.rest }}</span>
          </button>
        </template>
        <button
          v-else
          type="button"
          tabindex="-1"
          class="non-git-hint status-msg-standalone"
          @click="openFileModal('changes')"
        >Not a Git repository</button>
      </div>
      <div v-if="isGitRepo && !statusLoading && hasGitActions" class="git-actions">
        <GitActionBtn v-if="behind > 0" icon="pull" title="Pull" :count="behind" :running="isRunning(workspace, 'pull')" btn-class="pull-btn has-count" @action="doAction('pull')" />
        <GitActionBtn v-if="!hasUpstream && hasRemoteBranch" icon="set-upstream" title="Set Upstream" :running="isRunning(workspace, 'set-upstream')" btn-class="icon-only upstream-set-btn" @action="doAction('set-upstream')" />
        <GitActionBtn v-if="!hasUpstream && !hasRemoteBranch" icon="push-upstream" title="Push" :count="ahead" :running="isRunning(workspace, 'push-upstream')" btn-class="upstream-btn" @action="doAction('push-upstream')" />
        <GitActionBtn v-if="hasUpstream && ahead > 0" icon="push" title="Push" :count="ahead" :running="isRunning(workspace, 'push')" btn-class="push-btn has-count" @action="doAction('push')" />
      </div>
    </template>
    <button
      v-else
      type="button"
      tabindex="-1"
      class="status-empty-hint"
      @click="openWorkspaceModal"
    >
      <span class="mdi mdi-folder-open-outline status-btn-icon" aria-hidden="true"></span>
      <span class="status-empty-hint-text">Open a workspace to get started</span>
    </button>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useIsMobile } from "../composables/useIsMobile.js";
import { emit } from "../app-bridge.js";
import GitActionBtn from "./GitActionBtn.vue";
import { POLL_INTERVAL_MS } from "../utils/constants.js";
import { abbreviateBranch } from "../utils/git.js";

const { gitAction, isRunning } = useGitRemoteAction();
const { isMobile } = useIsMobile();

let pollTimer = null;

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    workspaceStore.fetchStatuses();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

onMounted(() => { startPolling(); });
onBeforeUnmount(() => { stopPolling(); });

const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const activeTab = computed(() =>
  terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId),
);
const workspace = computed(() => activeTab.value?.workspace || null);
const showHeader = computed(() => !layoutStore.isSplitMode);

const ws = computed(() =>
  workspaceStore.allWorkspaces.find((w) => w.name === workspace.value),
);

const isGitRepo = computed(() => ws.value?.is_git_repo === true);
const hasUpstream = computed(() => ws.value?.has_upstream !== false);
const hasRemoteBranch = computed(() => ws.value?.has_remote_branch !== false);
const ahead = computed(() => ws.value?.ahead || 0);
const behind = computed(() => ws.value?.behind || 0);

const hasGitActions = computed(() =>
  behind.value > 0 || ahead.value > 0 || !hasUpstream.value,
);
const isDirty = computed(() => ws.value && ws.value.clean === false);

const statusLoading = computed(() => ws.value && ws.value.last_commit_message === undefined);

const branchParts = computed(() => {
  const branch = ws.value?.branch || "";
  if (!isMobile.value) return { abbr: "", rest: branch };
  return abbreviateBranch(branch);
});
const isBranchLong = computed(() => {
  if (!isMobile.value) return false;
  return (branchParts.value.rest?.length || 0) > 10;
});
const msgText = computed(() => {
  if (!ws.value) return "";
  if (statusLoading.value) return "Loading";
  return ws.value.last_commit_message || "";
});
const changedFiles = computed(() => ws.value?.changed_files || 0);
const insertions = computed(() => ws.value?.insertions || 0);
const deletions = computed(() => ws.value?.deletions || 0);

function openFileModal(pane = "files") {
  if (workspace.value) {
    workspaceStore.selectedWorkspace = workspace.value;
  }
  emit("git:openFileModal", { pane });
}

function doAction(action) {
  const wsName = workspace.value;
  if (!wsName) return;
  const branch = ws.value?.branch || "";
  gitAction(wsName, action, { branch });
}

function openWorkspaceModal() {
  emit("workspace:openModal");
}

</script>

<style scoped>
.workspace-status-bar {
  display: none;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 4px 8px 6px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
}

.status-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 2px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  white-space: nowrap;
  color: var(--text-primary);
}

.status-nav-group {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 0;
}

.status-divider {
  width: 1px;
  height: 26px;
  background: color-mix(in srgb, var(--text-muted) 50%, var(--border));
  flex-shrink: 0;
}

.status-btn-icon {
  font-size: 15px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.status-btn-label {
  font-size: 12px;
  color: var(--text-muted);
  display: none;
}

.status-btn-label-always {
  display: inline;
}

.status-nav-btn:has(.status-btn-label-always) {
  padding: 0 8px;
}

@media (hover: hover) and (pointer: fine) {
  .status-btn-label {
    display: inline;
  }

  .status-nav-btn {
    padding: 0 8px;
  }

  .status-msg-btn .status-btn-label {
    display: none;
  }
}


.status-branch-btn {
  flex-shrink: 0;
  gap: 4px;
  padding-left: 8px;
  color: var(--text-primary);
  font-weight: 600;
}


.status-branch-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.branch-abbr {
  color: var(--accent);
  font-weight: 500;
}

.status-msg-btn {
  flex: 1;
  min-width: 0;
  gap: 4px;
  padding-left: 8px;
  justify-content: flex-start;
}

.status-msg-text {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  user-select: none;
  -webkit-user-select: none;
}

.status-msg-loading {
  color: var(--text-muted);
}

.status-msg-loading::after {
  content: "";
  animation: loading-dots 1.2s steps(4) infinite;
}

@keyframes loading-dots {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
}

.status-numstat-btn {
  flex-shrink: 0;
  gap: 6px;
  padding-left: 8px;
  padding-right: 8px;
  font-weight: 600;
  justify-content: flex-start;
}

.numstat-files {
  color: var(--warning);
}

.non-git-hint {
  color: var(--text-muted);
}

.status-msg-standalone {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  font-size: 12px;
  font-family: inherit;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  text-align: left;
}

.git-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.status-empty-hint {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-muted);
  text-align: left;
}

.status-empty-hint-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

@media (hover: hover) and (pointer: fine) {
  .status-nav-btn:hover,
  .status-empty-hint:hover {
    background: var(--bg-secondary);
  }
}

</style>
