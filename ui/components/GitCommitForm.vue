<template>
  <div class="diff-commit-form-wrapper">
    <textarea
      v-model="commitMessage"
      class="diff-commit-textarea"
      placeholder="Commit message"
      autocomplete="off"
      rows="3"
    ></textarea>
    <div v-if="error" class="form-error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "../composables/useApi.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { useToast } from "../composables/useToast.ts";
import { emit } from "../app-bridge.ts";
import { extractApiError } from "../utils/constants.ts";

const { apiCommand, wsEndpoint } = useApi();
const { confirm } = useConfirm();
const toast = useToast();
const workspaceStore = useWorkspaceStore();

const commitMessage = ref("");
const error = ref("");
const submitting = ref(false);

async function submit() {
  const msg = commitMessage.value.trim();
  if (!msg || submitting.value) return;

  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) {
    error.value = "No workspace selected";
    return;
  }

  if (!(await confirm(`Commit with message:\n\n"${msg}"`))) return;

  submitting.value = true;
  error.value = "";

  try {
    const { ok, data } = await apiCommand(wsEndpoint(workspace, "commit"), { message: msg });
    if (ok) {
      toast.success("Committed");
      commitMessage.value = "";
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

defineExpose({ open: () => {}, close: () => {}, submit, submitting, commitMessage });
</script>

<style scoped>
.diff-commit-form-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px 10px;
  flex-shrink: 0;
}

.diff-commit-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  min-height: 64px;
}

.diff-commit-textarea::placeholder {
  color: var(--text-muted);
}

.form-error {
  color: var(--error);
  font-size: 12px;
}
</style>
