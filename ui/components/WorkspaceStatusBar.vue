<template>
  <div class="workspace-status-bar" :style="{ display: showHeader ? 'flex' : 'none' }">
    <button type="button" class="status-mode-toggle" @click="toggleMode">
      <span :class="mode === 'git' ? 'mdi mdi-play-circle-outline' : 'mdi mdi-source-branch'"></span>
    </button>
    <template v-if="mode === 'git'">
      <template v-if="isGitRepo">
        <button type="button" class="status-branch-btn" tabindex="-1" @click="openFileModal('branch')">
          <span class="mdi mdi-source-branch status-btn-icon" aria-hidden="true"></span>{{ branchText }}
        </button>
        <button type="button" class="status-msg-btn" tabindex="-1" @click="openFileModal('history')">
          <span class="mdi mdi-history status-btn-icon" aria-hidden="true"></span>
          <span class="status-msg-text" :class="{ 'status-msg-loading': statusLoading }">{{ msgText }}</span>
        </button>
        <button v-if="isDirty && !statusLoading" type="button" class="status-numstat-btn" tabindex="-1" @click="openFileModal('changes')">
          <span class="mdi mdi-file-document-multiple-outline status-btn-icon" aria-hidden="true"></span>
          <span v-if="changedFiles > 0" class="numstat-files">{{ changedFiles }}F</span>
          <span class="diff-num-plus">+{{ insertions }}</span>
          <span class="diff-num-del">-{{ deletions }}</span>
        </button>
      </template>
      <button
        v-else-if="workspace"
        type="button"
        tabindex="-1"
        class="non-git-hint status-msg-standalone"
        @click="openFileModal('changes')"
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
        <div class="status-job-spacer"></div>
        <button type="button" class="status-job-btn status-terminal-btn" title="Terminal" @click="openTerminal">
          <span class="mdi mdi-console"></span>
        </button>
        <template v-if="currentCommonJobs.length">
          <div class="status-job-spacer"></div>
          <button
            v-for="job in currentCommonJobs"
            :key="job.name"
            type="button"
            class="status-job-btn"
            :class="{ 'status-job-hidden': job.hidden_tab }"
            :title="job.label || job.name"
            @click="runJob(job)"
          >
            <span v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
          </button>
        </template>
        <template v-if="currentLocalJobs.length">
          <div class="status-job-spacer"></div>
          <button
            v-for="job in currentLocalJobs"
            :key="job.name"
            type="button"
            class="status-job-btn"
            :class="{ 'status-job-hidden': job.hidden_tab }"
            :title="job.label || job.name"
            @click="runJob(job)"
          >
            <span v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
          </button>
        </template>
        <span v-if="currentCommonJobs.length === 0 && currentLocalJobs.length === 0" class="status-jobs-empty">No jobs</span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useRecentJobs } from "../composables/useRecentJobs.js";
import { useApi } from "../composables/useApi.js";
import { emit, on } from "../app-bridge.js";
import { useConfirm } from "../composables/useConfirm.js";
import GitActionBtn from "./GitActionBtn.vue";
import { renderIconStr } from "../utils/render-icon.js";
import { POLL_INTERVAL_MS, MOBILE_BREAKPOINT_PX } from "../utils/constants.js";
import { abbreviateBranch } from "../utils/git.js";
import { EP_JOBS_WORKSPACES } from "../utils/endpoints.js";

const { gitAction, isRunning } = useGitRemoteAction();
const { recordJob } = useRecentJobs();
const { apiGet } = useApi();
const { confirm } = useConfirm();

const mode = ref("git");
const jobsCache = {};
const currentCommonJobs = ref([]);
const currentLocalJobs = ref([]);

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

const isMobile = ref(window.innerWidth < MOBILE_BREAKPOINT_PX);
function onResize() { isMobile.value = window.innerWidth < MOBILE_BREAKPOINT_PX; }

onMounted(() => { startPolling(); window.addEventListener("resize", onResize); });
onBeforeUnmount(() => { stopPolling(); window.removeEventListener("resize", onResize); });

const offJobsRefresh = on("jobs:refresh", () => {
  for (const key of Object.keys(jobsCache)) delete jobsCache[key];
  loadJobs(workspace.value);
});
onBeforeUnmount(() => offJobsRefresh());

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

const branchText = computed(() => {
  const branch = ws.value?.branch || "";
  return isMobile.value ? abbreviateBranch(branch) : branch;
});
const msgText = computed(() => {
  if (!ws.value) return "";
  if (statusLoading.value) return "Loading";
  return ws.value.last_commit_message || "";
});
const changedFiles = computed(() => ws.value?.changed_files || 0);
const insertions = computed(() => ws.value?.insertions || 0);
const deletions = computed(() => ws.value?.deletions || 0);

function openFileModal(pane = "changes") {
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

function applyJobs(wsName) {
  const cached = jobsCache[wsName];
  if (!cached) {
    currentCommonJobs.value = [];
    currentLocalJobs.value = [];
    return;
  }
  currentCommonJobs.value = cached.filter((j) => j.common);
  currentLocalJobs.value = cached.filter((j) => !j.common);
}

async function loadJobs(wsName) {
  if (!wsName) { applyJobs(null); return; }
  if (jobsCache[wsName]) { applyJobs(wsName); return; }
  try {
    const { ok, data } = await apiGet(EP_JOBS_WORKSPACES);
    if (!ok) return;
    for (const [name, jobs] of Object.entries(data)) {
      jobsCache[name] = Object.entries(jobs)
        .filter(([n]) => n !== "terminal")
        .map(([n, job]) => ({ name: n, ...job }));
    }
    applyJobs(wsName);
  } catch { /* ignore */ }
}

watch(workspace, (wsName) => loadJobs(wsName), { immediate: true });

function openTerminal() {
  const wsName = workspace.value;
  if (!wsName) return;
  const wsData = ws.value;
  emit("terminal:launch", {
    workspace: wsName,
    icon: wsData?.icon,
    iconColor: wsData?.icon_color,
  });
  mode.value = "git";
}

async function runJob(job) {
  const wsName = workspace.value;
  if (!wsName) return;
  const wsData = ws.value;
  if (job.confirm !== false) {
    const preview = job.command ? (job.command.length > 300 ? job.command.slice(0, 300) + "..." : job.command) : job.name;
    if (!await confirm(`${job.label || job.name}\n\n${preview}`)) return;
  }
  if (wsData) recordJob(wsData, job);
  emit("terminal:launch", {
    workspace: wsName,
    icon: wsData?.icon,
    iconColor: wsData?.icon_color,
    jobName: job.name,
    jobLabel: job.label,
    jobIcon: job.icon,
    jobIconColor: job.icon_color,
    initialCommand: job.command,
    hidden: !!job.hidden_tab,
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

.status-branch-btn,
.status-msg-btn,
.status-numstat-btn {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  white-space: nowrap;
}

.status-btn-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.status-branch-btn {
  flex-shrink: 0;
  gap: 4px;
  color: var(--accent);
  font-weight: 600;
}

.status-msg-btn {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  gap: 4px;
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

.status-msg-muted {
  color: var(--text-muted);
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
  font-size: 13px;
  font-weight: 700;
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
  .status-branch-btn:hover,
  .status-msg-btn:hover,
  .status-numstat-btn:hover {
    background: var(--bg-secondary);
  }
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

.status-job-hidden {
  border-style: dashed;
}

.status-job-spacer {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: var(--border);
  flex-shrink: 0;
}

.status-jobs-empty {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
