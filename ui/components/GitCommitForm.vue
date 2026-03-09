<template>
  <div v-if="visible" class="diff-commit-form-wrapper" style="display:flex">
    <div class="git-create-branch-row diff-commit-row">
      <input
        ref="messageInput"
        v-model="commitMessage"
        type="text"
        class="form-input"
        placeholder="コミットメッセージ"
        autocomplete="off"
        @keydown.enter="submit"
      />
      <button type="button" class="primary" :disabled="!commitMessage.trim() || submitting" @click="submit">コミット</button>
      <button type="button" @click="close">閉じる</button>
    </div>
    <div v-if="error" class="form-error">{{ error }}</div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";

const auth = useAuthStore();
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
    error.value = "ワークスペースが選択されていません";
    submitting.value = false;
    return;
  }

  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/commit`, {
      method: "POST",
      body: { message: msg },
    });
    if (!res) {
      error.value = "コミットに失敗しました";
      submitting.value = false;
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      emit("toast:show", { message: "コミットしました", type: "success" });
      close();
      emit("git:commitDone");
    } else {
      error.value = data.stderr || data.detail || "コミットに失敗しました";
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    submitting.value = false;
  }
}

defineExpose({ open, close, visible });
</script>
