<template>
  <BaseDialog :visible="visible" :z-index="210" @dismiss="close">
    <div class="commit-dialog dialog-box" role="dialog" aria-modal="true" aria-label="Commit">
      <div class="dialog-title">Commit</div>
      <textarea
        v-model="commitMessage"
        class="form-input commit-dialog-textarea"
        placeholder="Commit message"
        rows="5"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
      ></textarea>
      <div v-if="error" class="form-error">{{ error }}</div>
      <div class="dialog-buttons">
        <button type="button" class="dialog-btn dialog-btn-cancel" :disabled="submitting" @click="close">Cancel</button>
        <button type="button" class="dialog-btn dialog-btn-ok" :disabled="!commitMessage.trim() || submitting" @click="submit">Commit</button>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import BaseDialog from "./BaseDialog.vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "../composables/useApi.ts";
import { buildActionResult } from "../utils/git-remote.ts";
import { emit } from "../app-bridge.ts";
import { extractApiError } from "../utils/constants.ts";

const { apiCommand, wsEndpoint } = useApi();
const workspaceStore = useWorkspaceStore();

const visible = ref(false);
const commitMessage = ref("");
const error = ref("");
const submitting = ref(false);

function open() {
  error.value = "";
  visible.value = true;
}

function close() {
  if (submitting.value) return;
  visible.value = false;
}

async function submit() {
  const msg = commitMessage.value.trim();
  if (!msg || submitting.value) return;

  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) {
    error.value = "No workspace selected";
    return;
  }

  submitting.value = true;
  error.value = "";

  try {
    const { ok, data } = await apiCommand(wsEndpoint(workspace, "commit"), { message: msg });
    if (ok) {
      emit("git:remoteDone", { wsName: workspace, result: buildActionResult("Committed", msg.split("\n")[0]) });
      commitMessage.value = "";
      visible.value = false;
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

defineExpose({ open });
</script>

<style scoped>
.commit-dialog-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: none;
  font-family: inherit;
  line-height: 1.4;
}

.form-error {
  color: var(--error);
  font-size: 12px;
}
</style>
