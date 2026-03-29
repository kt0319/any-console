<template>
  <div v-if="visible" class="diff-commit-form-wrapper">
    <div class="git-create-branch-row diff-commit-row">
      <input
        ref="messageInput"
        v-model="commitMessage"
        type="text"
        class="form-input"
        placeholder="Commit message"
        autocomplete="off"
        @keydown.enter="submit"
      />
      <button type="button" class="primary" :disabled="!commitMessage.trim() || submitting" @click="submit">Commit</button>
      <button type="button" @click="close">Close</button>
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { emit } from "../app-bridge.js";
import { extractApiError } from "../utils/constants.js";

const { apiCommand, wsEndpoint } = useApi();
const workspaceStore = useWorkspaceStore();

const visible = ref(false);
const commitMessage = ref("");
const error = ref("");
const submitting = ref(false);
const messageInput = ref(null);

function open() {
  visible.value = true;
  commitMessage.value = "";
  error.value = "";
  nextTick(() => messageInput.value?.focus());
}

function close() {
  visible.value = false;
  error.value = "";
}

async function submit() {
  const msg = commitMessage.value.trim();
  if (!msg || submitting.value) return;
  submitting.value = true;
  error.value = "";

  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) {
    error.value = "No workspace selected";
    submitting.value = false;
    return;
  }

  try {
    const { ok, data } = await apiCommand(wsEndpoint(workspace, "commit"), { message: msg });
    if (ok) {
      emit("toast:show", { message: "Committed", type: "success" });
      close();
      emit("git:commitDone");
    } else {
      error.value = extractApiError(data, "Commit failed");
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    submitting.value = false;
  }
}

defineExpose({ open, close, visible });
</script>

<style scoped>
.diff-commit-form-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px 10px;
  flex-shrink: 0;
}

.diff-commit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
  align-items: center;
}

.diff-commit-row .form-input {
  min-width: 0;
}

.diff-commit-row button {
  width: auto;
  min-width: 64px;
  min-height: 36px;
  height: 36px;
  padding: 0 12px;
  font-size: 12px;
}

.form-error {
  color: var(--error);
  font-size: 12px;
}
</style>
