<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <div class="terminal-ws-list">
        <div
          v-for="ws in visibleWorkspaces"
          :key="ws.name"
          class="picker-ws-group"
        >
          <div class="picker-ws-row picker-ws-row-top">
            <button type="button" class="picker-ws-header-label" @click="selectWorkspace(ws)">
              <span v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
              <span class="picker-ws-header-text">
                <span class="picker-ws-name">{{ ws.name }}</span>
                <span class="picker-ws-branch">{{ ws.branch || '-' }}</span>
              </span>
            </button>
            <div class="picker-ws-top-meta">
              <GitActionBtn v-if="ws.is_git_repo && ws.behind > 0" icon="pull" title="Pull" :count="ws.behind" :running="isRunning(ws.name, 'pull')" btn-class="picker-ws-mini-btn pull-btn has-count" @action="doAction(ws, 'pull')" />
              <GitActionBtn v-if="ws.is_git_repo && ws.ahead > 0 && ws.has_upstream !== false" icon="push" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push')" btn-class="picker-ws-mini-btn push-btn has-count" @action="doAction(ws, 'push')" />
              <GitActionBtn v-if="ws.is_git_repo && ws.ahead > 0 && ws.has_upstream === false" icon="push-upstream" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push-upstream')" btn-class="picker-ws-mini-btn upstream-btn" @action="doAction(ws, 'push-upstream')" />
              <button v-if="ws.is_git_repo && !ws.clean" type="button" class="git-badge dirty" v-html="dirtyBadgeHtml(ws)" @click="openDetail(ws)"></button>
            </div>
          </div>
          <div class="picker-ws-row picker-ws-row-bottom">
            <div class="picker-ws-icons picker-ws-icons-bottom">
              <button
                v-for="job in wsJobs[ws.name] || []"
                :key="job.name"
                type="button"
                class="picker-ws-icon-btn"
                :class="{ 'picker-ws-job-direct': job.terminal === false }"
                :title="job.label || job.name"
                @click="runJob(ws, job)"
              >
                <span v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
              </button>
            </div>
            <button type="button" class="picker-ws-icon-btn" title="ファイル" @click="openDetail(ws)">
              <span class="mdi mdi-folder-outline"></span>
            </button>
          </div>
        </div>
        <div v-if="visibleWorkspaces.length === 0" class="clone-repo-empty">
          表示中のワークスペースがありません
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, reactive } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useAuthStore } from "../stores/auth.js";
import { useGitAction } from "../composables/useGitAction.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import GitActionBtn from "./GitActionBtn.vue";

const modalTitle = inject("modalTitle");
modalTitle.value = "ワークスペース";

const workspaceStore = useWorkspaceStore();
const auth = useAuthStore();
const { gitAction, isRunning } = useGitAction();

const wsJobs = reactive({});

function doAction(ws, action) {
  gitAction(ws.name, action, { branch: ws.branch });
}

const visibleWorkspaces = computed(() => workspaceStore.visibleWorkspaces);

async function loadWorkspaceOverview() {
  await workspaceStore.fetchStatuses(auth);
  await fetchAllWorkspaceJobs();
}

async function fetchAllWorkspaceJobs() {
  for (const ws of visibleWorkspaces.value) {
    if (wsJobs[ws.name]) continue;
    loadWorkspaceJobs(ws.name);
  }
}

async function loadWorkspaceJobs(wsName) {
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(wsName)}/jobs`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const entries = Object.entries(data)
      .filter(([name]) => name !== "terminal")
      .map(([name, job]) => ({ name, ...job }));
    wsJobs[wsName] = entries;
  } catch {
    // ignore
  }
}

function dirtyBadgeHtml(ws) {
  const files = ws.changed_files || 0;
  const ins = ws.insertions || 0;
  const del = ws.deletions || 0;
  const filePart = files > 0 ? `<span class="header-git-files">${files}F</span> ` : "";
  return `${filePart}<span class="diff-num-plus">+${ins}</span> <span class="diff-num-del">-${del}</span>`;
}

function openDetail(ws) {
  workspaceStore.selectedWorkspace = ws.name;
  emit("git:openFileModal");
}

function selectWorkspace(ws) {
  emit("modal:close");
  emit("terminal:launch", {
    workspace: ws.name,
    icon: ws.icon,
    iconColor: ws.icon_color,
  });
}

function runJob(ws, job) {
  emit("modal:close");
  if (job.terminal === false) {
    emit("job:exec", { jobName: job.name, job, workspace: ws.name });
    return;
  }
  if (job.confirm !== false) {
    const preview = job.command ? (job.command.length > 300 ? job.command.slice(0, 300) + "..." : job.command) : job.name;
    if (!confirm(`${job.label || job.name}\n\n${preview}`)) return;
  }
  emit("terminal:launch", {
    workspace: ws.name,
    icon: ws.icon,
    iconColor: ws.icon_color,
    jobName: job.name,
    jobLabel: job.label,
    jobIcon: job.icon,
    jobIconColor: job.icon_color,
    initialCommand: job.command,
  });
}

defineExpose({
  load: loadWorkspaceOverview,
  loadWorkspaceOverview,
});
</script>

<style scoped>
.split-tab-content {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-height: 0;
  overflow: visible;
}

.split-tab-scroll {
  padding-top: 4px;
}

.terminal-ws-list {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.picker-ws-group {
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  position: relative;
}

.picker-ws-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.picker-ws-row-top {
  padding-bottom: 4px;
}

.picker-ws-row-bottom {
  padding: 4px 12px 14px;
}

.picker-ws-header-label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}

.picker-ws-header-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex: 1;
}

.picker-ws-name {
  min-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.picker-ws-branch {
  max-width: 100%;
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-ws-top-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.picker-ws-top-meta :deep(.git-badge),
.picker-ws-top-meta :deep(.picker-ws-mini-btn),
.picker-ws-top-meta :deep(.git-action-btn) {
  height: 22px;
  min-height: 22px;
  max-height: 22px;
  min-width: auto;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1;
}

.picker-ws-icons {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.picker-ws-icons-bottom {
  flex: 1;
  min-width: 0;
  gap: 8px;
  justify-content: flex-start;
}

.picker-ws-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}

.picker-ws-icon-btn.picker-ws-job-direct {
  border-style: dashed;
}

.picker-ws-icon-btn .mdi {
  font-size: 18px;
}

.picker-ws-mini-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-muted);
  cursor: pointer;
}

.picker-ws-mini-btn .mdi {
  font-size: 12px;
}

.picker-ws-mini-btn.pull-btn.has-count {
  color: var(--error);
  background: rgba(255, 85, 114, 0.15);
  border-color: rgba(255, 85, 114, 0.3);
}

.picker-ws-mini-btn.push-btn.has-count {
  color: var(--accent);
  background: rgba(130, 170, 255, 0.15);
  border-color: rgba(130, 170, 255, 0.3);
}

.picker-ws-mini-btn.upstream-set-btn {
  color: var(--warning);
  background: rgba(238, 166, 68, 0.15);
  border-color: rgba(238, 166, 68, 0.3);
}

.picker-ws-mini-btn.upstream-btn {
  color: var(--success);
  background: rgba(120, 200, 140, 0.15);
  border-color: rgba(120, 200, 140, 0.3);
}

.picker-ws-mini-btn.running {
  pointer-events: none;
  color: transparent;
}

.picker-ws-mini-btn.running > * {
  visibility: hidden;
}

.git-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

button.git-badge:disabled {
  opacity: 0.5;
  cursor: default;
}

.git-badge.clean {
  color: var(--success);
  background: var(--success-bg-20);
}

.git-badge.dirty {
  color: var(--warning);
  background: var(--warning-bg-20);
  gap: 4px;
  font-size: 12px;
}

.clone-repo-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
