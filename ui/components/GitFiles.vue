<template>
  <div class="git-files-pane-wrapper">
    <div class="diff-file-list">
      <div v-if="isLoading" class="text-muted-center">Loading...</div>
      <ul v-else class="file-browser-list diff-file-browser-list">
        <template v-for="file in files" :key="file.path">
          <FileItem
            class="diff-file-row"
            :selected="selectedFile === file.path"
            :label="file.path"
            :icon-html="fileIconHtml(file)"
            :long-press-surface="longPress.activeEntry.value?.path === file.path"
            @click="onFileClick(file, $event)"
            @contextmenu="onFileContextMenu(file)"
            @mouseenter="onFileMouseEnter(file)"
            @mouseleave="onFileMouseLeave"
            @mousedown="longPress.startMenu($event, file)"
            @mouseup="longPress.endMenu()"
            @touchstart="longPress.startMenu($event, file)"
            @touchend="longPress.endMenu()"
            @touchcancel="longPress.endMenu()"
          >
            <template #right>
              <span v-if="file.numstat" class="diff-file-row-numstat" v-html="file.numstat"></span>
              <span :class="['diff-file-row-status', statusClass(file.status)]">{{ file.status }}</span>
            </template>
          </FileItem>
          <FileActionMenu
            v-if="contextEntry?.path === file.path"
            :actions="contextMenuActions"
            @menu-enter="onMenuMouseEnter"
            @menu-leave="onMenuMouseLeave"
          />
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
import FileActionMenu from "./FileActionMenu.vue";
import GitCommitForm from "./GitCommitForm.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitDiff } from "../composables/useGitDiff.js";
import { useEditorIntegration } from "../composables/useEditorIntegration.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useHoverMenu, isHoverDevice } from "../composables/useHoverMenu.js";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useWorkspace } from "../composables/useWorkspace.js";
import { useWorkspaceFile } from "../composables/useWorkspaceFile.js";
import { emit } from "../app-bridge.js";
import { renderFileIconFromPath } from "../utils/file-icon.js";
import { GIT_DIFF_STATUS_CLASSES } from "../utils/constants.js";
import { workspaceGitDiscardPath } from "../utils/endpoints.js";

const workspaceStore = useWorkspaceStore();
const { fetchWorkingTreeDiff, fetchCommitDiff } = useGitDiff();
const { editorUrlTemplate, fetchEditorSettings, openInEditor } = useEditorIntegration();
const { apiPost } = useApi();
const { confirm } = useConfirm();
const { withWorkspace } = useWorkspace();
const { downloadWorkspaceFile, deleteWorkspaceFile } = useWorkspaceFile();
const longPress = useLongPress();

const files = ref([]);
const isLoading = ref(false);
const selectedFile = ref("");
const actionButtons = ref([]);
const isWorkingTree = ref(false);
const commitForm = ref(null);
const {
  contextEntry,
  openMenu,
  closeMenu: closeHoverMenu,
  onItemMouseEnter: onFileMouseEnter,
  onItemMouseLeave: onFileMouseLeave,
  onMenuMouseEnter, onMenuMouseLeave,
} = useHoverMenu();

const isCommitDisabled = computed(
  () => !commitForm.value?.commitMessage?.value?.trim() || !!commitForm.value?.submitting?.value,
);
const isStashDisabled = computed(() => files.value.length === 0);

function statusClass(status) {
  return GIT_DIFF_STATUS_CLASSES[status] || "";
}

function fileIconHtml(file) {
  return renderFileIconFromPath(file.path);
}

function githubFileUrl(file) {
  const ws = workspaceStore.currentWorkspace;
  if (!ws?.github_url) return "";
  return `${ws.github_url}/blob/${ws.branch || "main"}/${file.path}`;
}

const contextMenuActions = computed(() => {
  const file = contextEntry.value;
  if (!file) return [];
  return [
    { icon: "mdi-eye-outline", label: "View", handler: () => viewDiff(file) },
    { icon: "mdi-folder-open-outline", label: "Show in Files", handler: () => browseToFolder(file) },
    { icon: "mdi-file-edit-outline", label: "Editor", show: !!editorUrlTemplate.value, handler: () => { openInEditor(file.path); closeMenu(); } },
    { icon: "mdi-download", label: "Download", handler: () => downloadFile(file) },
    { icon: "mdi-github", label: "GitHub", show: !!githubFileUrl(file), handler: () => openFileGithub(file) },
    { icon: "mdi-undo", label: "Discard", show: isWorkingTree.value, danger: true, handler: () => discardFile(file) },
    { icon: "mdi-delete-outline", label: "Delete", show: isWorkingTree.value, danger: true, handler: () => deleteFile(file) },
  ];
});

function closeMenu() {
  closeHoverMenu();
  longPress.closeMenu();
}

function onFileContextMenu(file) {
  openMenu(file);
}

function onFileClick(file, _event) {
  if (!isHoverDevice) {
    if (longPress.consumeFired()) return;
    if (contextEntry.value?.path === file.path) {
      closeMenu();
      selectFile(file);
      return;
    }
    openMenu(file);
    return;
  }
  selectFile(file);
}

function viewDiff(file) {
  closeMenu();
  selectFile(file);
}

function openFileGithub(file) {
  const url = githubFileUrl(file);
  if (url) window.open(url, "_blank");
  closeMenu();
}

function browseToFolder(file) {
  closeMenu();
  const parts = file.path.split("/");
  parts.pop();
  emit("git:browseToFolder", { path: parts.join("/") });
}

function selectFile(file) {
  selectedFile.value = file.path;
  emit("git:selectDiffFile", { path: file.path });
}

async function discardFile(file) {
  closeMenu();
  if (!await confirm(`Discard changes to "${file.path}"? This cannot be undone.`)) return;
  await withWorkspace(async (workspace) => {
    const result = await apiPost(
      workspaceGitDiscardPath(workspace),
      { path: file.path },
      { errorMessage: `Failed to discard ${file.path}` },
    );
    if (result.ok) {
      emit("git:refreshStatus");
      await loadWorkingTreeDiff();
    }
  });
}

async function downloadFile(file) {
  closeMenu();
  await downloadWorkspaceFile(file.path);
}

async function deleteFile(file) {
  closeMenu();
  if (!await confirm(`Delete file "${file.path}"? This cannot be undone.`)) return;
  const ok = await deleteWorkspaceFile(file.path);
  if (ok) {
    emit("git:refreshStatus");
    await loadWorkingTreeDiff();
  }
}

async function loadWorkingTreeDiff() {
  await withWorkspace(async () => {
    isLoading.value = true;
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
      if (!result) return;
      files.value = result.fileList;
    } catch (e) {
      console.error("diff load failed:", e);
    } finally {
      isLoading.value = false;
    }
  });
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

fetchEditorSettings();

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

.diff-actions button {
  font-size: 13px;
  padding: 7px 14px;
  min-height: 0;
}

.diff-action-spin {
  animation: diff-action-spin 0.6s linear infinite;
}

@keyframes diff-action-spin {
  to { transform: rotate(360deg); }
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
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.file-browser-action-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
}

.file-browser-action-menu button {
  padding: 5px 10px;
  font-size: 11px;
  min-height: 0;
}

.file-browser-action-delete {
  color: var(--error);
  border-color: var(--error);
}

</style>
