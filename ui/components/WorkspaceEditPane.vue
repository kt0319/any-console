<template>
  <div class="ws-settings-detail">
    <div class="ws-settings-row">
      <span class="ws-settings-label">Icon</span>
      <button type="button" class="icon-select-btn" @click="openIconPicker">
        <span class="icon-select-preview">
          <span v-html="renderIconStr(editIcon || 'mdi-console', editIconColor, 18)"></span>
          <span class="icon-select-label">{{ editIcon || 'Default' }}</span>
        </span>
      </button>
    </div>

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
      <button type="button" class="ws-delete-btn" @click="onDelete">
        <span class="mdi mdi-delete-outline"></span>
        Delete Workspace
      </button>
    </div>

    <div v-if="saveError" class="clone-repo-error">{{ saveError }}</div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useWorkspaceJobManager } from "../composables/useWorkspaceJobManager.js";
import { renderIconStr } from "../utils/render-icon.js";
import { MSG_SAVE_FAILED, MSG_DELETE_FAILED, MSG_ERROR_OCCURRED } from "../utils/constants.js";
import { EP_WORKSPACES } from "../utils/endpoints.js";

const props = defineProps({
  workspace: { type: Object, required: true },
  pushView: { type: Function, required: true },
  viewState: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["deleted", "updated"]);

const DEFAULT_WS_ICON = "mdi-console";

const editWs = ref(props.workspace);
watch(() => props.workspace, (next) => { editWs.value = next; });

const editIcon = ref(editWs.value?.icon || "");
const editIconColor = ref(editWs.value?.icon_color || "");
const saveError = ref("");

const { apiPut, apiDelete, wsEndpoint } = useApi();
const { confirm } = useConfirm();

const { jobEntries, isLoadingJobs, loadWorkspaceJobs, startAddJob, startEditJob, deleteJob } =
  useWorkspaceJobManager({ editWs, pushView: props.pushView });

async function onDelete() {
  if (!editWs.value) return;
  if (!await confirm(`Delete "${editWs.value.name}"?\nThe directory will remain.`)) return;
  const { ok, data } = await apiDelete(`${EP_WORKSPACES}/${encodeURIComponent(editWs.value.name)}`, { errorMessage: MSG_DELETE_FAILED });
  if (ok) {
    emit("deleted", editWs.value.name);
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
      emit("updated");
    }
  } catch (e) {
    saveError.value = e.message || MSG_ERROR_OCCURRED;
  }
}

function openIconPicker() {
  props.pushView("IconPicker", {
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

onMounted(() => {
  loadWorkspaceJobs();
  if ("pendingIcon" in (props.viewState || {})) {
    editIcon.value = props.viewState.pendingIcon;
    editIconColor.value = props.viewState.pendingColor ?? "";
    delete props.viewState.pendingIcon;
    delete props.viewState.pendingColor;
    saveWsConfig();
  }
});
</script>

<style>
@import "../styles/settings-list.css";
</style>

<style scoped>
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
