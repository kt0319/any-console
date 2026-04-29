<template>
  <div class="modal-scroll-body">
    <!-- ワークスペース一覧 -->
    <div v-if="!editWs" ref="wsListEl" class="ws-config-list">
      <div
        v-for="(ws, idx) in allWorkspaces"
        :key="ws.name"
        class="ws-check-item"
        :class="{ dragging: dragIdx === idx }"
        :style="dragIdx === idx ? { transform: `translateY(${dragOffsetY}px)` } : {}"
      >
        <span
          class="drag-handle"
          @mousedown.prevent="onDragStart($event, idx)"
          @touchstart.prevent="onDragStart($event, idx)"
        ><span class="mdi mdi-drag"></span></span>
        <label class="ws-check-row">
          <input type="checkbox" class="form-checkbox" :checked="!ws.hidden" @change="toggleVisibility(ws, $event.target.checked)" />
          <span class="ws-icon-display" v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
          <span class="ws-check-label">{{ ws.name }}</span>
        </label>
        <span v-if="wsJobCounts[ws.name]" class="ws-job-count-badge">{{ wsJobCounts[ws.name] }}</span>
        <button type="button" class="picker-ws-icon-btn ws-gear-btn" @click="openWsSettings(ws)">
          <span class="mdi mdi-cog"></span>
        </button>
      </div>
      <div v-if="allWorkspaces.length === 0" class="clone-repo-empty">No workspaces</div>
    </div>

    <!-- ワークスペース個別設定 -->
    <div v-if="editWs" class="ws-settings-detail">
      <div class="ws-settings-row">
        <span class="ws-settings-label">Icon</span>
        <button type="button" class="icon-select-btn" @click="openIconPicker">
          <span class="icon-select-preview">
            <span v-html="renderIconStr(editIcon || 'mdi-console', editIconColor, 18)"></span>
            <span class="icon-select-label">{{ editIcon || 'Default' }}</span>
          </span>
        </button>
      </div>

      <!-- ジョブ一覧 -->
      <div class="ws-settings-section">
        <div class="ws-settings-section-header">
          <span>Jobs</span>
          <button type="button" class="ws-add-item-btn" @click="startAddJob">
            <span class="mdi mdi-plus"></span>
          </button>
        </div>
        <div class="ws-settings-item-list">
          <div v-if="isLoadingJobs" class="ws-settings-empty">Loading...</div>
          <div v-else-if="jobEntries.length === 0" class="ws-settings-empty">No jobs</div>
          <div
            v-for="entry in jobEntries"
            :key="entry.name"
            class="ws-settings-item"
            :class="{ 'ws-settings-item-global': entry.job.global }"
            @click="entry.job.global ? null : startEditJob(entry)"
          >
            <span class="ws-settings-item-icon" v-html="renderIconStr(entry.job.icon || 'mdi-play', entry.job.icon_color, 16)"></span>
            <span class="ws-settings-item-name">{{ entry.job.label || entry.name }}</span>
            <span v-if="entry.job.global" class="ws-settings-item-badge">Global</span>
            <div v-if="!entry.job.global" class="ws-settings-item-actions">
              <button type="button" class="ws-settings-item-action-btn" title="Delete" @click.stop="deleteJob(entry)">
                <span class="mdi mdi-delete-outline"></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="ws-settings-section ws-delete-section">
        <button type="button" class="ws-delete-btn" @click="deleteWorkspace">
          <span class="mdi mdi-delete-outline"></span>
          Delete Workspace
        </button>
      </div>

      <div v-if="saveError" class="clone-repo-error">{{ saveError }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watchEffect, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { useWorkspaceDrag } from "../composables/useWorkspaceDrag.js";
import { useWorkspaceJobManager } from "../composables/useWorkspaceJobManager.js";
import { renderIconStr } from "../utils/render-icon.js";
import { MSG_SAVE_FAILED, MSG_DELETE_FAILED, MSG_ERROR_OCCURRED } from "../utils/constants.js";
import { EP_JOBS_WORKSPACES, EP_WORKSPACES } from "../utils/endpoints.js";
import { useConfirm } from "../composables/useConfirm.js";

const { modalTitle, pushView, viewState } = useModalView();
modalTitle.value = "Workspace Settings";

const workspaceStore = useWorkspaceStore();
const { apiGet, apiPut, apiDelete, wsEndpoint } = useApi();
const { confirm } = useConfirm();

const wsListEl = ref(null);
const allWorkspaces = ref([]);
const editWs = ref(null);
watchEffect(() => {
  modalTitle.value = editWs.value ? editWs.value.name : "Workspace Settings";
});
const DEFAULT_WS_ICON = "mdi-console";

const editIcon = ref("");
const editIconColor = ref("");
const saveError = ref("");

const wsJobCounts = ref({});
const { jobEntries, isLoadingJobs, loadWorkspaceJobs, startAddJob, startEditJob, deleteJob } = useWorkspaceJobManager({ editWs, pushView });

const { dragIdx, dragOffsetY, onDragStart, cleanup: cleanupDrag } = useWorkspaceDrag({
  items: allWorkspaces,
  listEl: wsListEl,
  onReorder: () => saveWorkspaceOrder(),
});

async function loadWorkspaceConfig() {
  await workspaceStore.fetchWorkspaces();
  allWorkspaces.value = workspaceStore.allWorkspaces || [];
  loadAllJobCounts();
}

async function loadAllJobCounts() {
  try {
    const { ok, data } = await apiGet(EP_JOBS_WORKSPACES);
    if (!ok) return;
    const counts = {};
    for (const [name, jobs] of Object.entries(data)) {
      counts[name] = Object.entries(jobs).filter(([k, j]) => k !== "terminal" && !j.global).length;
    }
    wsJobCounts.value = counts;
  } catch { /* ignore */ }
}

async function toggleVisibility(ws, checked) {
  try {
    await apiPut(wsEndpoint(ws.name, "config"), { icon: ws.icon || "", icon_color: ws.icon_color || "", hidden: !checked });
    ws.hidden = !checked;
  } catch { /* ignore */ }
}

function openWsSettings(ws) {
  editWs.value = ws;
  editIcon.value = ws.icon || "";
  editIconColor.value = ws.icon_color || "";
  saveError.value = "";
  loadWorkspaceJobs();
}

function goBackToList() {
  editWs.value = null;
  jobEntries.value = [];
}

function handleBack() {
  if (editWs.value) {
    goBackToList();
    return true;
  }
  return false;
}

async function deleteWorkspace() {
  if (!editWs.value) return;
  if (!await confirm(`Delete "${editWs.value.name}"?\nThe directory will remain.`)) return;
  const { ok, data } = await apiDelete(`${EP_WORKSPACES}/${encodeURIComponent(editWs.value.name)}`, { errorMessage: MSG_DELETE_FAILED });
  if (ok) {
    goBackToList();
    await loadWorkspaceConfig();
  } else if (data?.detail) {
    saveError.value = data.detail;
  }
}

async function saveWsConfig() {
  if (!editWs.value) return;
  saveError.value = "";
  try {
    const { ok, data } = await apiPut(wsEndpoint(editWs.value.name, "config"), {
      icon: editIcon.value.trim() || DEFAULT_WS_ICON,
      icon_color: editIconColor.value.trim(),
      hidden: !!editWs.value.hidden,
    });
    if (!ok) {
      saveError.value = data?.detail || MSG_SAVE_FAILED;
    } else {
      editWs.value.icon = editIcon.value.trim() || DEFAULT_WS_ICON;
      editWs.value.icon_color = editIconColor.value.trim();
      workspaceStore.fetchWorkspaces();
    }
  } catch (e) {
    saveError.value = e.message || MSG_ERROR_OCCURRED;
  }
}

function openIconPicker() {
  pushView("IconPicker", {
    currentIcon: editIcon.value,
    currentColor: editIconColor.value,
    onReturn: (result, parentEntry) => {
      if (parentEntry) {
        parentEntry.state.initialWsName = editWs.value?.name;
        parentEntry.state.pendingIcon = result.icon;
        parentEntry.state.pendingColor = result.color;
      }
    },
  });
}

async function saveWorkspaceOrder() {
  const order = allWorkspaces.value.map((ws) => ws.name);
  try {
    await apiPut("/workspace-order", { order });
  } catch { /* ignore */ }
}

onBeforeUnmount(() => {
  cleanupDrag();
});

defineExpose({ handleBack });

onMounted(async () => {
  await loadWorkspaceConfig();
  const initialWsName = viewState.value?.initialWsName;
  if (initialWsName) {
    const ws = allWorkspaces.value.find((w) => w.name === initialWsName);
    if (ws) openWsSettings(ws);
  }
  if ("pendingIcon" in (viewState.value || {})) {
    editIcon.value = viewState.value.pendingIcon;
    editIconColor.value = viewState.value.pendingColor ?? "";
    delete viewState.value.pendingIcon;
    delete viewState.value.pendingColor;
    saveWsConfig();
  }
});
</script>

<style>
@import "../styles/settings-list.css";
</style>

<style scoped>
.ws-check-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 14px;
  min-height: 44px;
}

.ws-check-item:last-child {
  border-bottom: none;
}

.ws-check-item.dragging {
  opacity: 0.72;
  background: var(--bg-tertiary);
}

.ws-check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.ws-check-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-icon-display {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  font-size: 18px;
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

.picker-ws-icon-btn .mdi {
  font-size: 18px;
}

.ws-job-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: 10px;
  flex-shrink: 0;
}

.ws-gear-btn {
  width: 30px;
  height: 30px;
  min-width: 30px;
  min-height: 30px;
  padding: 0;
  font-size: 15px;
  flex-shrink: 0;
  line-height: 1;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.ws-settings-item.dragging {
  opacity: 0.72;
  background: var(--bg-tertiary);
}

.ws-delete-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.ws-delete-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 12px;
  font-size: 13px;
  color: var(--error);
  background: transparent;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  cursor: pointer;
  justify-content: center;
}

.icon-select-preview .mdi {
  font-size: 18px;
  vertical-align: middle;
}

.icon-select-preview :deep(.favicon-icon) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.ws-settings-item-global {
  opacity: 0.6;
  cursor: default;
}

.ws-settings-item-badge {
  font-size: 10px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1px 6px;
  flex-shrink: 0;
}

</style>
