<template>
  <div class="git-files-pane-wrapper">
    <div v-if="actionButtons.length" class="diff-actions">
      <button
        v-for="action in actionButtons"
        :key="action.label"
        type="button"
        :class="action.class || ''"
        @click="action.handler"
      >{{ action.label }}</button>
    </div>
    <div class="diff-file-list">
      <div v-if="isLoading" class="text-muted-center">Loading...</div>
      <ul v-else class="file-browser-list diff-file-browser-list">
        <FileItem
          v-for="file in files"
          :key="file.path"
          class="diff-file-row"
          :selected="selectedFile === file.path"
          :label="file.path"
          :icon-html="fileIconHtml(file)"
          @click="selectFile(file)"
        >
          <template #right>
            <span v-if="file.numstat" class="diff-file-row-numstat" v-html="file.numstat"></span>
            <span :class="['diff-file-row-status', statusClass(file.status)]">{{ file.status }}</span>
          </template>
        </FileItem>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import FileItem from "./FileItem.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitDiff } from "../composables/useGitDiff.js";
import { emit } from "../app-bridge.js";
import { renderFileIconFromPath } from "../utils/file-icon.js";
import { GIT_DIFF_STATUS_CLASSES } from "../utils/constants.js";

const workspaceStore = useWorkspaceStore();
const { fetchWorkingTreeDiff, fetchCommitDiff } = useGitDiff();

const files = ref([]);
const isLoading = ref(false);
const selectedFile = ref("");
const actionButtons = ref([]);

function statusClass(status) {
  return GIT_DIFF_STATUS_CLASSES[status] || "";
}

function fileIconHtml(file) {
  return renderFileIconFromPath(file.path);
}

async function loadWorkingTreeDiff() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  isLoading.value = true;
  try {
    const result = await fetchWorkingTreeDiff();
    if (!result) { isLoading.value = false; return; }
    files.value = result.fileList;
    actionButtons.value = [
      { label: "Commit", class: "primary", handler: () => emit("git:openCommitForm") },
      { label: "Stash", handler: () => emit("git:stashSave") },
    ];
  } catch (e) {
    console.error("diff load failed:", e);
  } finally {
    isLoading.value = false;
  }
}

async function loadCommitDiff(hash) {
  isLoading.value = true;
  try {
    const result = await fetchCommitDiff(hash);
    if (!result) { isLoading.value = false; return; }
    files.value = result.fileList;
    actionButtons.value = [];
  } catch (e) {
    console.error("commit diff load failed:", e);
  } finally {
    isLoading.value = false;
  }
}

function selectFile(file) {
  selectedFile.value = file.path;
  emit("git:selectDiffFile", { path: file.path });
}

defineExpose({ loadWorkingTreeDiff, loadCommitDiff });
</script>

<style scoped>
.git-files-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.diff-actions {
  display: flex;
  gap: 6px;
  padding: 6px 10px;
  flex-shrink: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.diff-file-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  -webkit-overflow-scrolling: touch;
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

</style>
