<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <RecentJobsBar
        :recent-jobs="recentJobs"
        :settings-active="settingsMode"
        @run="runRecentJob"
        @settings="toggleSettingsMode"
      />
      <div ref="wsListEl" class="terminal-ws-list" :class="{ 'is-settings-mode': settingsMode }">
        <div
          v-for="(ws, idx) in displayWorkspaces"
          :key="ws.name"
          class="picker-ws-group"
          :class="{ dragging: dragIdx === idx }"
          :style="dragIdx === idx ? { transform: `translateY(${dragOffsetY}px)` } : {}"
          @mouseenter="!settingsMode && onMouseEnter(ws)"
          @mouseleave="!settingsMode && onMouseLeave(ws)"
        >
          <div class="picker-ws-row picker-ws-row-top">
            <span
              v-if="settingsMode"
              class="picker-ws-drag-handle"
              @mousedown.prevent="onDragStart($event, idx)"
              @touchstart.prevent="onDragStart($event, idx)"
            ><span class="mdi mdi-drag"></span></span>
            <input
              v-if="settingsMode"
              type="checkbox"
              class="form-checkbox picker-ws-checkbox"
              :checked="!ws.hidden"
              @change="toggleVisibility(ws, $event.target.checked)"
            />
            <button type="button" class="picker-ws-header-label" @click="!settingsMode && (isExpanded(ws.name) ? openDetail(ws) : toggleExpand(ws))">
              <span v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
              <span class="picker-ws-header-text">
                <span class="picker-ws-name">{{ ws.name }}</span>
                <span v-if="!settingsMode" class="picker-ws-branch">{{ ws.branch || '-' }}</span>
              </span>
            </button>
            <button v-if="settingsMode" type="button" class="picker-ws-delete-btn" title="Delete" @click.stop="deleteWs(ws)">
              <span class="mdi mdi-delete-outline"></span>
            </button>
            <div v-else class="picker-ws-top-meta" @click.stop="onMetaClick(ws)">
              <template v-if="ws.is_git_repo">
                <button v-if="ws.clean === false" type="button" class="git-badge dirty" v-html="dirtyBadgeHtml(ws)" @click.stop="openDetail(ws)"></button>
                <GitActionBtn v-if="ws.behind > 0" icon="pull" title="Pull" :count="ws.behind" :running="isRunning(ws.name, 'pull')" btn-class="picker-ws-mini-btn pull-btn has-count" @action="doAction(ws, 'pull')" />
                <GitActionBtn v-if="ws.ahead > 0 && ws.has_upstream !== false" icon="push" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push')" btn-class="picker-ws-mini-btn push-btn has-count" @action="doAction(ws, 'push')" />
                <GitActionBtn v-if="ws.ahead > 0 && ws.has_upstream === false" icon="push-upstream" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push-upstream')" btn-class="picker-ws-mini-btn upstream-btn" @action="doAction(ws, 'push-upstream')" />
              </template>
              <span class="picker-ws-chevron mdi" :class="isExpanded(ws.name) ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
            </div>
          </div>
          <div v-show="!settingsMode && isExpanded(ws.name)" class="picker-ws-row picker-ws-row-bottom">
            <div class="picker-ws-icons picker-ws-icons-bottom">
              <button type="button" class="picker-ws-icon-btn" title="Terminal" @click="selectWorkspace(ws)">
                <span class="mdi mdi-console"></span>
              </button>
              <template v-if="wsCommonJobs[ws.name]?.length">
                <div class="picker-ws-job-spacer"></div>
                <button
                  v-for="job in wsCommonJobs[ws.name]"
                  :key="job.name"
                  type="button"
                  class="picker-ws-icon-btn"
                  :class="{ 'picker-ws-job-hidden': job.hidden_tab, 'picker-ws-job-common': true }"
                  :title="job.label || job.name"
                  @click="runJob(ws, job)"
                >
                  <span v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
                </button>
              </template>
              <template v-if="wsLocalJobs[ws.name]?.length">
                <div class="picker-ws-job-spacer"></div>
                <button
                  v-for="job in wsLocalJobs[ws.name]"
                  :key="job.name"
                  type="button"
                  class="picker-ws-icon-btn"
                  :class="{ 'picker-ws-job-hidden': job.hidden_tab }"
                  :title="job.label || job.name"
                  @click="runJob(ws, job)"
                >
                  <span v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
                </button>
              </template>
              <button type="button" class="picker-ws-icon-btn picker-ws-info-btn" title="Detail" @click.stop="openDetail(ws)">
                <span class="mdi mdi-information-outline"></span>
              </button>
            </div>
          </div>
        </div>
        <div v-if="visibleWorkspaces.length === 0" class="clone-repo-empty">
          No workspaces to display
        </div>
      </div>
    </div>
  </div>
</template>


<script setup>
import { computed, inject, reactive, ref, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLayoutStore } from "../stores/layout.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useRecentJobs } from "../composables/useRecentJobs.js";
import { useApi } from "../composables/useApi.js";
import { useJobLauncher } from "../composables/useJobLauncher.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import { EP_JOBS_WORKSPACES } from "../utils/endpoints.js";
import GitActionBtn from "./GitActionBtn.vue";
import RecentJobsBar from "./RecentJobsBar.vue";
import { useConfirm } from "../composables/useConfirm.js";
import { useWorkspaceDrag } from "../composables/useWorkspaceDrag.js";
import { EP_WORKSPACE_ORDER } from "../utils/endpoints.js";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "Workspaces";

const workspaceStore = useWorkspaceStore();
const layoutStore = useLayoutStore();
const { apiGet, apiPut, apiDelete, wsEndpoint } = useApi();
const { gitAction, isRunning } = useGitRemoteAction();
const { recentJobs, loadRecentJobs } = useRecentJobs();
const { runJob, runRecentJob } = useJobLauncher();
const { confirm } = useConfirm();

const wsCommonJobs = reactive({});
const wsLocalJobs = reactive({});
const expandedName = ref(null);
const settingsMode = ref(false);
const wsListEl = ref(null);

const displayWorkspaces = computed(() => settingsMode.value
  ? (workspaceStore.allWorkspaces || [])
  : workspaceStore.visibleWorkspaces);

const { dragIdx, dragOffsetY, onDragStart, cleanup: cleanupDrag } = useWorkspaceDrag({
  items: displayWorkspaces,
  listEl: wsListEl,
  onReorder: () => saveWorkspaceOrder(),
});

function toggleSettingsMode() {
  settingsMode.value = !settingsMode.value;
}

async function deleteWs(ws) {
  if (!await confirm(`Delete "${ws.name}"?\nThe directory will remain.`)) return;
  const { ok } = await apiDelete(`/workspaces/${encodeURIComponent(ws.name)}`, { errorMessage: "Failed to delete workspace" });
  if (ok) await workspaceStore.fetchWorkspaces();
}

async function toggleVisibility(ws, checked) {
  try {
    const { ok } = await apiPut(wsEndpoint(ws.name, "config"), {
      icon: ws.icon || "",
      icon_color: ws.icon_color || "",
      hidden: !checked,
    }, { errorMessage: "Failed to update workspace" });
    if (ok) ws.hidden = !checked;
  } catch { /* ignore */ }
}

async function saveWorkspaceOrder() {
  const order = displayWorkspaces.value.map((ws) => ws.id || ws.name);
  try {
    await apiPut(EP_WORKSPACE_ORDER, { order }, { errorMessage: "Failed to save workspace order" });
  } catch { /* ignore */ }
}

function isExpanded(name) {
  return expandedName.value === name;
}

function toggleExpand(ws) {
  expandedName.value = expandedName.value === ws.name ? null : ws.name;
}

function onMouseEnter(ws) {
  if (!layoutStore.isTouchDevice) {
    expandedName.value = ws.name;
  }
}

function onMouseLeave(ws) {
  if (!layoutStore.isTouchDevice && expandedName.value === ws.name) {
    expandedName.value = null;
  }
}

function onMetaClick(ws) {
  if (layoutStore.isTouchDevice) {
    toggleExpand(ws);
  }
}

function doAction(ws, action) {
  gitAction(ws.name, action, { branch: ws.branch });
}

const visibleWorkspaces = computed(() => workspaceStore.visibleWorkspaces);

async function loadWorkspaceOverview() {
  await Promise.all([
    workspaceStore.fetchStatuses(),
    loadAllWorkspaceJobs(),
  ]);
}

async function loadAllWorkspaceJobs() {
  try {
    const { ok, data } = await apiGet(EP_JOBS_WORKSPACES);
    if (!ok) return;
    for (const ws of visibleWorkspaces.value) {
      const jobs = data[ws.name] || {};
      const all = Object.entries(jobs)
        .filter(([name]) => name !== "terminal")
        .map(([name, job]) => ({ name, ...job }));
      wsCommonJobs[ws.name] = all.filter((j) => j.common);
      wsLocalJobs[ws.name] = all.filter((j) => !j.common);
    }
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
  pushView("WorkspaceDetail", { detail: {} });
}

function selectWorkspace(ws) {
  emit("modal:close");
  emit("terminal:launch", {
    workspace: ws.name,
    icon: ws.icon,
    iconColor: ws.icon_color,
  });
}

onMounted(() => {
  loadWorkspaceOverview();
  loadRecentJobs();
});

onBeforeUnmount(() => {
  cleanupDrag();
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

.picker-ws-group.dragging {
  opacity: 0.72;
  background: var(--bg-tertiary);
}

.picker-ws-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: var(--text-muted);
  cursor: grab;
  touch-action: none;
}

.picker-ws-drag-handle .mdi {
  font-size: 18px;
}

.picker-ws-checkbox {
  flex-shrink: 0;
}

.picker-ws-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  margin-left: auto;
  padding: 0;
  background: transparent;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  color: var(--error);
  font-size: 16px;
  cursor: pointer;
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

.picker-ws-chevron {
  font-size: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-left: 4px;
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
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}

.picker-ws-info-btn {
  margin-left: auto;
}


.picker-ws-icon-btn.picker-ws-job-hidden {
  border-style: dashed;
}

.picker-ws-job-spacer {
  width: 1px;
  align-self: stretch;
  margin: 4px 2px;
  background: var(--border);
  flex-shrink: 0;
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
  border-radius: var(--radius);
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
  border-radius: var(--radius);
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
