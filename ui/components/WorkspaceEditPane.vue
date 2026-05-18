<template>
  <div class="modal-scroll-body ws-settings-detail">
    <div class="ws-settings-section">
      <div class="ws-settings-section-header">
        <span>Details</span>
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Icon</span>
        <button type="button" class="icon-select-btn" @click="openIconPicker">
          <span class="icon-select-preview">
            <span v-html="renderIconStr(editIcon || 'mdi-console', editIconColor, 18)"></span>
            <span class="icon-select-label">{{ editIcon || 'Default' }}</span>
          </span>
        </button>
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Name</span>
        <input type="text" class="form-input" v-model="editName" autocomplete="off" />
      </div>
      <div class="ws-settings-row">
        <span class="ws-settings-label">Path</span>
        <input type="text" class="form-input" v-model="editPath" autocomplete="off" />
      </div>
      <div class="ws-settings-row" style="gap:8px">
        <button type="button" class="primary" :disabled="savingDetails || !isDetailsDirty" @click="saveDetails">
          {{ savingDetails ? 'Saving...' : 'Save' }}
        </button>
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
import { ref, computed, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useModalView } from "../composables/useModalView.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { renderIconStr } from "../utils/render-icon.js";
import { MSG_SAVE_FAILED, MSG_DELETE_FAILED, MSG_ERROR_OCCURRED } from "../utils/constants.js";
import { EP_WORKSPACES } from "../utils/endpoints.js";

const DEFAULT_WS_ICON = "mdi-console";

const { modalTitle, viewState, pushView, popView } = useModalView();
const workspaceStore = useWorkspaceStore();

const editWs = ref(viewState.value?.workspace || null);
const editIcon = ref(editWs.value?.icon || "");
const editIconColor = ref(editWs.value?.icon_color || "");
const editName = ref(editWs.value?.name || "");
const editPath = ref(editWs.value?.path || "");
const savingDetails = ref(false);
const saveError = ref("");

modalTitle.value = editWs.value?.name || "Workspace";

const isDetailsDirty = computed(() =>
  editName.value.trim() !== (editWs.value?.name || "")
  || editPath.value.trim() !== (editWs.value?.path || ""),
);

const { apiPut, apiDelete, wsEndpoint } = useApi();
const { confirm } = useConfirm();

async function onDelete() {
  if (!editWs.value) return;
  if (!await confirm(`Delete "${editWs.value.name}"?\nThe directory will remain.`)) return;
  const { ok, data } = await apiDelete(`${EP_WORKSPACES}/${encodeURIComponent(editWs.value.name)}`, { errorMessage: MSG_DELETE_FAILED });
  if (ok) {
    await workspaceStore.fetchWorkspaces();
    popView();
  } else if (data?.detail) {
    saveError.value = data.detail;
  }
}

async function saveWsConfig(extra = {}) {
  if (!editWs.value) return false;
  saveError.value = "";
  try {
    const identifier = editWs.value.id || editWs.value.name;
    const { ok, data } = await apiPut(wsEndpoint(identifier, "config"), {
      icon: editIcon.value.trim() || DEFAULT_WS_ICON,
      icon_color: editIconColor.value.trim(),
      hidden: !!editWs.value.hidden,
      ...extra,
    });
    if (!ok) {
      saveError.value = data?.detail || MSG_SAVE_FAILED;
      return false;
    }
    editWs.value.icon = editIcon.value.trim() || DEFAULT_WS_ICON;
    editWs.value.icon_color = editIconColor.value.trim();
    await workspaceStore.fetchWorkspaces();
    const next = (workspaceStore.allWorkspaces || []).find((w) =>
      (editWs.value.id && w.id === editWs.value.id) || w.name === (extra.name || editWs.value.name),
    );
    if (next) {
      editWs.value = next;
      editName.value = next.name || "";
      editPath.value = next.path || "";
      modalTitle.value = next.name || modalTitle.value;
    }
    return true;
  } catch (e) {
    saveError.value = e.message || MSG_ERROR_OCCURRED;
    return false;
  }
}

async function saveDetails() {
  if (!editWs.value || savingDetails.value) return;
  savingDetails.value = true;
  try {
    await saveWsConfig({
      name: editName.value.trim(),
      path: editPath.value.trim(),
    });
  } finally {
    savingDetails.value = false;
  }
}

function openIconPicker() {
  pushView("IconPicker", {
    currentIcon: editIcon.value,
    currentColor: editIconColor.value,
    onReturn: (result, parentEntry) => {
      if (parentEntry) {
        parentEntry.state.pendingIcon = result.icon;
        parentEntry.state.pendingColor = result.color;
      }
    },
  });
}

onMounted(() => {
  if (viewState.value && "pendingIcon" in viewState.value) {
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
.ws-delete-section {
  margin-top: 20px;
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
</style>
