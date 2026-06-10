<template>
  <!-- グループ名入力モーダル -->
  <div v-if="groupDialogOpen" class="picker-group-overlay" @click.self="groupDialogOpen = false">
    <div class="picker-group-dialog" role="dialog" aria-modal="true">
      <div class="picker-group-dialog-title">{{ editingGroup ? 'Rename group' : 'Add group' }}</div>
      <input
        ref="groupInputEl"
        v-model="groupInputName"
        class="form-input"
        type="text"
        placeholder="Group name"
        autocomplete="off"
        @keydown.enter.prevent="submitGroupDialog"
        @keydown.esc.prevent="groupDialogOpen = false"
      />
      <div class="picker-group-dialog-buttons">
        <button v-if="editingGroup" class="prompt-btn prompt-btn-danger" @click="deleteGroup(editingGroup)">Delete</button>
        <span class="picker-group-dialog-spacer"></span>
        <button class="prompt-btn prompt-btn-cancel" @click="groupDialogOpen = false">Cancel</button>
        <button class="prompt-btn prompt-btn-ok" :disabled="!groupInputName.trim()" @click="submitGroupDialog">
          {{ editingGroup ? 'Rename' : 'Create' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { EP_GROUPS } from "../utils/endpoints.js";

const workspaceStore = useWorkspaceStore();
const { apiPost, apiPut, apiDelete } = useApi();
const { confirm } = useConfirm();

// グループダイアログ
const groupDialogOpen = ref(false);
const groupInputName = ref("");
const groupInputEl = ref(null);
const editingGroup = ref(null);

function startAddGroup() {
  editingGroup.value = null;
  groupInputName.value = "";
  groupDialogOpen.value = true;
  nextTick(() => groupInputEl.value?.focus());
}

function startRenameGroup(group) {
  editingGroup.value = group;
  groupInputName.value = group.name;
  groupDialogOpen.value = true;
  nextTick(() => groupInputEl.value?.focus());
}

async function submitGroupDialog() {
  const name = groupInputName.value.trim();
  if (!name) return;
  groupDialogOpen.value = false;
  if (editingGroup.value) {
    const { ok } = await apiPut(`${EP_GROUPS}/${editingGroup.value.id}`, { name }, { errorMessage: "Failed to rename group" });
    if (ok) await workspaceStore.fetchGroups();
  } else {
    const { ok } = await apiPost(EP_GROUPS, { name }, { errorMessage: "Failed to create group" });
    if (ok) await workspaceStore.fetchGroups();
  }
}

async function deleteGroup(group) {
  groupDialogOpen.value = false;
  if (!await confirm(`Delete group "${group.name}"? Workspaces in this group will be unassigned.`)) return;
  const { ok } = await apiDelete(`${EP_GROUPS}/${group.id}`, { errorMessage: "Failed to delete group" });
  if (!ok) return;
  await workspaceStore.fetchGroups();
  await workspaceStore.fetchWorkspaces();
}

defineExpose({ openAdd: startAddGroup, openRename: startRenameGroup });
</script>

<style scoped>
/* グループ名ダイアログ */
.picker-group-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
  padding: 20px;
}

.picker-group-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  width: min(320px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.picker-group-dialog-title {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.picker-group-dialog-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

.picker-group-dialog-spacer {
  flex: 1;
}

.prompt-btn-danger {
  padding: 6px 14px;
  background: transparent;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  color: var(--error);
  font-size: 13px;
  cursor: pointer;
}
</style>
