<template>
  <div class="workspace-status-bar" :style="{ display: showHeader ? 'flex' : 'none' }">
    <button type="button" class="status-mode-toggle" @click="toggleMode">
      <span :class="mode === 'git' ? 'mdi mdi-play-circle-outline' : 'mdi mdi-source-branch'"></span>
    </button>
    <template v-if="mode === 'git'">
      <button
        v-if="isGitRepo"
        type="button"
        tabindex="-1"
        class="commit-msg-btn"
        :title="commitTooltip"
        @click="openFileModal"
        v-html="commitMsgHtml + numstatHtml"
      />
      <button
        v-else-if="workspace"
        type="button"
        tabindex="-1"
        class="non-git-hint commit-msg-btn"
        @click="openFileModal"
      >Not a Git repository</button>
      <div v-if="isGitRepo && !statusLoading && hasGitActions" class="git-actions">
        <GitActionBtn v-if="behind > 0" icon="pull" title="Pull" :count="behind" :running="isRunning(workspace, 'pull')" btn-class="pull-btn has-count" @action="doAction('pull')" />
        <GitActionBtn v-if="!hasUpstream && hasRemoteBranch" icon="set-upstream" title="Set Upstream" :running="isRunning(workspace, 'set-upstream')" btn-class="icon-only upstream-set-btn" @action="doAction('set-upstream')" />
        <GitActionBtn v-if="!hasUpstream && !hasRemoteBranch" icon="push-upstream" title="Push" :count="ahead" :running="isRunning(workspace, 'push-upstream')" btn-class="upstream-btn" @action="doAction('push-upstream')" />
        <GitActionBtn v-if="hasUpstream && ahead > 0" icon="push" title="Push" :count="ahead" :running="isRunning(workspace, 'push')" btn-class="push-btn has-count" @action="doAction('push')" />
      </div>
    </template>
    <template v-else>
      <div class="status-jobs">
        <button
          v-for="job in currentJobs"
          :key="job.name"
          type="button"
          class="status-job-btn"
          :class="{ 'status-job-direct': job.terminal === false }"
          :title="job.label || job.name"
          @click="runJob(job)"
        >
          <span v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
        </button>
        <span v-if="currentJobs.length === 0" class="status-jobs-empty">No jobs</span>
      </div>
      <button type="button" class="status-job-btn status-terminal-btn" title="Terminal" @click="openTerminal">
        <span class="mdi mdi-console"></span>
      </button>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useGitAction } from "../composables/useGitAction.js";
import { useApi } from "../composables/useApi.js";
import { emit } from "../app-bridge.js";
import GitActionBtn from "./GitActionBtn.vue";
import { renderIconStr } from "../utils/render-icon.js";
import { escapeHtml } from "../utils/escape-html.js";
import { POLL_INTERVAL_MS } from "../utils/constants.js";

const { gitAction, isRunning } = useGitAction();
const { apiGet } = useApi();

const mode = ref("git");
const jobsCache = {};
const currentJobs = ref([]);

function toggleMode() {
  mode.value = mode.value === "git" ? "jobs" : "git";
}

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

onMounted(() => startPolling());
onBeforeUnmount(() => stopPolling());

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

const commitMsgHtml = computed(() => {
  if (!ws.value) return "";
  if (statusLoading.value) {
    const branch = ws.value.branch || "";
    return `<span class="commit-btn-branch">${escapeHtml(branch)}</span>` +
      `<span class="commit-btn-msg-wrap"><span class="commit-btn-msg commit-btn-loading">Loading</span></span>`;
  }
  const branch = ws.value.branch || "";
  const msg = isDirty.value ? "Changes" : (ws.value.last_commit_message || "");
  const msgClass = isDirty.value ? "commit-btn-msg commit-btn-msg-muted" : "commit-btn-msg";
  const escaped = escapeHtml(msg);
  return `<span class="commit-btn-branch">${escapeHtml(branch)}</span>` +
    `<span class="commit-btn-msg-wrap"><span class="${msgClass}">${escaped}</span></span>`;
});

const commitTooltip = computed(() => "History");

const numstatHtml = computed(() => {
  if (!ws.value || !isDirty.value) return "";
  const changedFiles = ws.value.changed_files || 0;
  const insertions = ws.value.insertions || 0;
  const deletions = ws.value.deletions || 0;
  const fileCountHtml = changedFiles > 0 ? `<span class="header-git-files">${changedFiles}F</span>` : "";
  return `<span class="header-git-numstat">${fileCountHtml}<span class="diff-num-plus">+${insertions}</span><span class="diff-num-del">-${deletions}</span></span>`;
});

function openFileModal() {
  if (workspace.value) {
    workspaceStore.selectedWorkspace = workspace.value;
  }
  emit("git:openFileModal");
}

function doAction(action) {
  const wsName = workspace.value;
  if (!wsName) return;
  const branch = ws.value?.branch || "";
  gitAction(wsName, action, { branch });
}

async function fetchJobs(wsName) {
  if (!wsName) { currentJobs.value = []; return; }
  if (jobsCache[wsName]) { currentJobs.value = jobsCache[wsName]; return; }
  try {
    const { ok, data } = await apiGet("/jobs/workspaces");
    if (!ok) return;
    for (const [name, jobs] of Object.entries(data)) {
      jobsCache[name] = Object.entries(jobs)
        .filter(([n]) => n !== "terminal")
        .map(([n, job]) => ({ name: n, ...job }));
    }
    currentJobs.value = jobsCache[wsName] || [];
  } catch { /* ignore */ }
}

watch(workspace, (wsName) => fetchJobs(wsName), { immediate: true });

function openTerminal() {
  const wsName = workspace.value;
  if (!wsName) return;
  const wsData = ws.value;
  emit("terminal:launch", {
    workspace: wsName,
    icon: wsData?.icon,
    iconColor: wsData?.icon_color,
  });
}

function runJob(job) {
  const wsName = workspace.value;
  if (!wsName) return;
  const wsData = ws.value;
  if (job.terminal === false) {
    emit("job:exec", { jobName: job.name, job, workspace: wsName });
    mode.value = "git";
    return;
  }
  if (job.confirm !== false) {
    const preview = job.command ? (job.command.length > 300 ? job.command.slice(0, 300) + "..." : job.command) : job.name;
    if (!confirm(`${job.label || job.name}\n\n${preview}`)) return;
  }
  emit("terminal:launch", {
    workspace: wsName,
    icon: wsData?.icon,
    iconColor: wsData?.icon_color,
    jobName: job.name,
    jobLabel: job.label,
    jobIcon: job.icon,
    jobIconColor: job.icon_color,
    initialCommand: job.command,
  });
  mode.value = "git";
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

.commit-msg-btn {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 36px;
  min-height: 36px;
  max-height: 36px;
  box-sizing: border-box;
  line-height: 1;
  padding: 0 10px;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  overflow: hidden;
  gap: 6px;
  text-align: left;
}

.non-git-hint {
  color: var(--text-muted);
}

.git-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.commit-msg-btn :deep(.commit-btn-branch) {
  flex-shrink: 0;
  color: var(--accent);
  font-weight: 600;
}

.commit-msg-btn :deep(.commit-btn-msg-wrap) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.commit-msg-btn :deep(.commit-btn-msg) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
  user-select: none;
  -webkit-user-select: none;
  white-space: nowrap;
}

.commit-msg-btn :deep(.commit-btn-msg-muted) {
  color: var(--text-muted);
}

.commit-msg-btn :deep(.commit-btn-loading) {
  color: var(--text-muted);
}

.commit-msg-btn :deep(.commit-btn-loading)::after {
  content: "";
  animation: loading-dots 1.2s steps(4) infinite;
}

@keyframes loading-dots {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
}

.commit-msg-btn :deep(.header-git-numstat) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
  font-size: 13px;
  line-height: 1;
  font-weight: 700;
  white-space: nowrap;
}

.commit-msg-btn :deep(.header-git-files) {
  color: var(--warning);
}

.status-mode-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}

.status-jobs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.status-jobs::-webkit-scrollbar {
  display: none;
}

.status-job-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-primary);
}

.status-job-direct {
  border-style: dashed;
}

.status-jobs-empty {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
