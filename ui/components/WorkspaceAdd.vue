<template>
  <div class="modal-scroll-body">
    <div class="settings-section-label">Add Existing Directory</div>
    <div class="clone-form-row">
      <input
        type="text"
        class="form-input"
        v-model="addPath"
        placeholder="Full path (e.g. /home/user/projects/myapp)"
        autocomplete="off"
      />
    </div>
    <div class="clone-form-row">
      <button type="button" class="primary" :disabled="adding" @click="doAddExisting">
        {{ adding ? 'Adding...' : 'Add' }}
      </button>
    </div>
    <div v-if="addError" class="clone-repo-error">{{ addError }}</div>
    <div v-if="addSuccess" class="clone-repo-success">{{ addSuccess }}</div>
  </div>
</template>

<script setup>
import { ref, inject } from "vue";
import { useApi } from "../composables/useApi.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { MSG_ERROR_OCCURRED } from "../utils/constants.js";
import { EP_WORKSPACES } from "../utils/endpoints.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Add Workspace";

const workspaceStore = useWorkspaceStore();
const { apiPost } = useApi();

const addPath = ref("");
const adding = ref(false);
const addError = ref("");
const addSuccess = ref("");

async function doAddExisting() {
  if (!addPath.value.trim()) { addError.value = "Please enter a path"; return; }
  adding.value = true;
  addError.value = "";
  addSuccess.value = "";
  try {
    const { ok, data } = await apiPost(EP_WORKSPACES, { path: addPath.value.trim() });
    if (!ok) {
      addError.value = data?.detail || "Failed to add";
    } else {
      addSuccess.value = `${data?.name || "directory"} added`;
      addPath.value = "";
      workspaceStore.fetchWorkspaces();
    }
  } catch (e) {
    addError.value = e.message || MSG_ERROR_OCCURRED;
  } finally {
    adding.value = false;
  }
}
</script>

<style scoped>
.settings-section-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.clone-repo-success {
  color: var(--success);
  padding: 8px;
  text-align: center;
}
</style>
