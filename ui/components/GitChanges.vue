<template>
  <div class="git-changes-pane-wrapper">
    <div class="diff-file-list">
      <div v-if="isLoading" class="text-muted-center">Loading...</div>
      <div v-else-if="loadError" class="text-muted-center">{{ loadError }}</div>
      <div v-else-if="files.length === 0" class="text-muted-center">No changes</div>
      <ul v-else class="file-browser-list diff-file-browser-list">
        <template v-for="file in files" :key="file.path">
          <FileItem
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
        </template>
      </ul>
    </div>
    <GitCommitForm ref="commitForm" />
    <div v-if="actionButtons.length" class="diff-actions">
      <button
        v-for="action in actionButtons"
        :key="action.label"
        type="button"
        :class="action.class || ''"
        :disabled="action.loading || action.disabled?.()"
        @click="action.handler"
      >
        <span v-if="action.loading" class="mdi mdi-loading diff-action-spin"></span>
        <template v-else>{{ action.label }}</template>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import FileItem from "./FileItem.vue";
import GitCommitForm from "./GitCommitForm.vue";
import { useGitDiff } from "../composables/useGitDiff.js";
import { useWorkspace } from "../composables/useWorkspace.js";
import { emit } from "../app-bridge.js";
import { renderFileIconFromPath } from "../utils/file-icon.js";
import { GIT_DIFF_STATUS_CLASSES } from "../utils/constants.js";

const { fetchWorkingTreeDiff, fetchCommitDiff } = useGitDiff();
const { getWorkspace } = useWorkspace();

const files = ref([]);
const isLoading = ref(false);
const loadError = ref("");
const selectedFile = ref("");
const actionButtons = ref([]);
const isWorkingTree = ref(false);
const commitForm = ref(null);

const isCommitDisabled = computed(
  // defineExpose された ref はテンプレート ref 経由では自動アンラップされる（.value を付けると常に undefined）
  () => !commitForm.value?.commitMessage?.trim() || !!commitForm.value?.submitting,
);
const isStashDisabled = computed(() => files.value.length === 0);

function statusClass(status) {
  return GIT_DIFF_STATUS_CLASSES[status] || "";
}

function fileIconHtml(file) {
  return renderFileIconFromPath(file.path);
}

function selectFile(file) {
  selectedFile.value = file.path;
  emit("git:selectDiffFile", { path: file.path, isWorkingTree: isWorkingTree.value });
}

async function loadWorkingTreeDiff() {
  if (!getWorkspace()) {
    loadError.value = "No workspace selected";
    return;
  }
  isLoading.value = true;
  loadError.value = "";
  isWorkingTree.value = true;
  const stashBtn = {
    label: "Stash",
    loading: false,
    disabled: () => isStashDisabled.value,
    handler: async () => { stashBtn.loading = true; emit("git:stashSave"); },
  };
  actionButtons.value = [
    { label: "Commit", class: "primary", disabled: () => isCommitDisabled.value, handler: () => commitForm.value?.submit() },
    stashBtn,
  ];
  try {
    const result = await fetchWorkingTreeDiff();
    if (!result) {
      loadError.value = "Failed to load changes";
      return;
    }
    files.value = result.fileList;
  } catch (e) {
    loadError.value = "Failed to load changes";
    console.error("diff load failed:", e);
  } finally {
    isLoading.value = false;
  }
}

async function loadCommitDiff(hash) {
  isLoading.value = true;
  isWorkingTree.value = false;
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

defineExpose({ loadWorkingTreeDiff, loadCommitDiff });
</script>

<style scoped>
.git-changes-pane-wrapper {
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

.diff-actions button {
  font-size: 13px;
  padding: 7px 14px;
  min-height: 0;
}

.diff-action-spin {
  animation: spin 0.6s linear infinite;
}


.diff-file-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  flex: 1 1 auto;
  min-height: 0;
}


</style>
