<template>
  <div class="ws-settings-row">
    <span class="ws-settings-label">Group</span>
    <select v-if="workspaceStore.groups.length" v-model="groupId" class="form-input" aria-label="Group">
      <option :value="null">— None —</option>
      <option v-for="g in workspaceStore.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
    </select>
    <span v-else class="ws-group-field-empty">No groups</span>
    <button v-if="selectedGroup" type="button" class="ws-group-field-btn hover-bg-text" aria-label="Edit group" data-tooltip="Edit group" @click="groupDialog?.openRename(selectedGroup)">
      <span class="mdi mdi-pencil-outline" aria-hidden="true"></span>
    </button>
    <button type="button" class="ws-group-field-btn hover-bg-text" aria-label="Add group" data-tooltip="Add group" @click="groupDialog?.openAdd()">
      <span class="mdi mdi-plus" aria-hidden="true"></span>
    </button>
    <WorkspaceGroupDialog ref="groupDialog" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import WorkspaceGroupDialog from "./WorkspaceGroupDialog.vue";
import { useWorkspaceStore } from "../stores/workspace.ts";

const groupId = defineModel<string | null>({ default: null });
const workspaceStore = useWorkspaceStore();
const groupDialog = ref<InstanceType<typeof WorkspaceGroupDialog> | null>(null);

const selectedGroup = computed(() => workspaceStore.groups.find((g) => g.id === groupId.value) ?? null);

// 選択中のグループがダイアログから削除されたら選択を外す
watch(() => workspaceStore.groups, (groups) => {
  if (groupId.value !== null && !groups.some((g) => g.id === groupId.value)) groupId.value = null;
});
</script>

<style scoped>
.ws-group-field-empty {
  flex: 1;
  font-size: 13px;
  color: var(--text-muted);
}

.ws-group-field-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}
</style>
