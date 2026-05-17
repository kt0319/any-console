<template>
  <div class="workspace-status-bar" :style="{ display: showHeader ? 'flex' : 'none' }">
    <div class="status-nav-group">
      <button type="button" class="status-nav-btn" title="Files" @click="openFileModal('files')">
        <span class="mdi mdi-folder-outline status-btn-icon" aria-hidden="true"></span>
      </button>
      <div class="status-divider"></div>
      <button type="button" class="status-nav-btn" title="Jobs" @click="openFileModal('jobs')">
        <span class="mdi mdi-play-circle-outline status-btn-icon" aria-hidden="true"></span>
      </button>
      <template v-if="isGitRepo">
        <div class="status-divider"></div>
        <button type="button" class="status-nav-btn status-numstat-btn" :class="{ 'is-empty': !isDirty || statusLoading }" tabindex="-1" @click="openFileModal('changes')">
          <span class="mdi mdi-file-document-multiple-outline status-btn-icon" aria-hidden="true"></span>
          <template v-if="isDirty && !statusLoading">
            <span v-if="changedFiles > 0" class="numstat-files">{{ changedFiles }}F</span>
            <span class="diff-num-plus">+{{ insertions }}</span>
            <span class="diff-num-del">-{{ deletions }}</span>
          </template>
        </button>
        <div class="status-divider"></div>
        <button type="button" class="status-nav-btn status-msg-btn" tabindex="-1" @click="openFileModal('history')">
          <span class="mdi mdi-history status-btn-icon" aria-hidden="true"></span>
          <span class="status-msg-text" :class="{ 'status-msg-loading': statusLoading }">{{ msgText }}</span>
        </button>
        <div class="status-divider"></div>
        <button type="button" class="status-nav-btn status-branch-btn" tabindex="-1" @click="openFileModal('branch')">
          <span class="mdi mdi-source-branch status-btn-icon" aria-hidden="true"></span>
          <span class="status-branch-text"><span v-if="branchParts.abbr" class="branch-abbr">{{ branchParts.abbr }}</span>{{ branchParts.rest }}</span>
        </button>
      </template>
      <button
        v-else-if="workspace"
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
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { emit } from "../app-bridge.js";
import GitActionBtn from "./GitActionBtn.vue";
import { POLL_INTERVAL_MS, MOBILE_BREAKPOINT_PX } from "../utils/constants.js";
import { abbreviateBranch } from "../utils/git.js";

const { gitAction, isRunning } = useGitRemoteAction();

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

const mobileQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
const isMobile = ref(mobileQuery.matches);
function onMobileChange(e) { isMobile.value = e.matches; }

onMounted(() => { startPolling(); mobileQuery.addEventListener("change", onMobileChange); });
onBeforeUnmount(() => { stopPolling(); mobileQuery.removeEventListener("change", onMobileChange); });

const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const activeTab = computed(() =>
  terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId),
);
const workspace = computed(() => activeTab.value?.workspace || null);
const showHeader = computed(() => !layoutStore.isSplitMode && !!workspace.value);

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

.status-branch-btn {
  flex-shrink: 0;
  gap: 4px;
  padding-left: 8px;
  color: var(--text-primary);
  font-weight: 600;
}

@media (max-width: 767px) {
  .status-branch-btn {
    max-width: 140px;
  }
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
  overflow: hidden;
  gap: 4px;
  padding-left: 8px;
  justify-content: flex-start;
}

.status-msg-text {
  display: block;
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
}

.status-numstat-btn.is-empty {
  padding-left: 2px;
  padding-right: 2px;
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

@media (hover: hover) and (pointer: fine) {
  .status-nav-btn:hover {
    background: var(--bg-secondary);
  }
}

</style>
