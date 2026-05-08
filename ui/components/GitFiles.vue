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
          <li
            v-if="contextEntry?.path === file.path"
            class="file-browser-action-menu"
            @mouseenter="onMenuMouseEnter"
            @mouseleave="onMenuMouseLeave"
          >
            <button type="button" @click="viewDiff(file)"><span class="mdi mdi-file-document-outline"></span> View diff</button>
            <button v-if="editorUrlTemplate" type="button" @click="openInEditor(file.path); closeMenu()"><span class="mdi mdi-file-edit-outline"></span> Editor</button>
            <button type="button" @click="downloadFile(file)"><span class="mdi mdi-download"></span> Download</button>
            <button v-if="githubFileUrl(file)" type="button" @click="openFileGithub(file)"><span class="mdi mdi-github"></span> GitHub</button>
            <button v-if="isWorkingTree" type="button" class="file-browser-action-delete" @click="discardFile(file)"><span class="mdi mdi-undo"></span> Discard</button>
            <button v-if="isWorkingTree" type="button" class="file-browser-action-delete" @click="deleteFile(file)"><span class="mdi mdi-delete-outline"></span> Delete</button>
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import FileItem from "./FileItem.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitDiff } from "../composables/useGitDiff.js";
import { useEditorIntegration } from "../composables/useEditorIntegration.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useApi } from "../composables/useApi.js";
import { useAuthStore } from "../stores/auth.js";
import { emit } from "../app-bridge.js";
import { renderFileIconFromPath } from "../utils/file-icon.js";
import { triggerBlobDownload } from "../utils/download.js";
import { GIT_DIFF_STATUS_CLASSES } from "../utils/constants.js";
import { workspaceGitDiscardPath } from "../utils/endpoints.js";

const workspaceStore = useWorkspaceStore();
const { fetchWorkingTreeDiff, fetchCommitDiff } = useGitDiff();
const { editorUrlTemplate, fetchEditorSettings, openInEditor } = useEditorIntegration();
const { apiPost, apiCommand, wsEndpoint } = useApi();
const auth = useAuthStore();
const longPress = useLongPress();

const files = ref([]);
const isLoading = ref(false);
const selectedFile = ref("");
const actionButtons = ref([]);
const isWorkingTree = ref(false);
const contextEntry = ref(null);

const isHoverDevice = window.matchMedia("(hover: hover)").matches;
let hoverCloseTimer = null;

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

function closeMenu() {
  contextEntry.value = null;
  longPress.closeMenu();
}

function onFileMouseEnter(file) {
  if (!isHoverDevice) return;
  clearTimeout(hoverCloseTimer);
  contextEntry.value = file;
}

function onFileMouseLeave() {
  if (!isHoverDevice) return;
  hoverCloseTimer = setTimeout(() => { contextEntry.value = null; }, 150);
}

function onMenuMouseEnter() {
  clearTimeout(hoverCloseTimer);
}

function onMenuMouseLeave() {
  hoverCloseTimer = setTimeout(() => { contextEntry.value = null; }, 150);
}

function onFileContextMenu(file) {
  contextEntry.value = file;
}

function onFileClick(file, _event) {
  if (!isHoverDevice) {
    if (longPress.consumeFired()) return;
    if (contextEntry.value?.path === file.path) {
      closeMenu();
      selectFile(file);
      return;
    }
    contextEntry.value = file;
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

function selectFile(file) {
  selectedFile.value = file.path;
  emit("git:selectDiffFile", { path: file.path });
}

async function discardFile(file) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  closeMenu();
  const result = await apiPost(
    workspaceGitDiscardPath(workspace),
    { path: file.path },
    { errorMessage: `Failed to discard ${file.path}` },
  );
  if (result.ok) {
    emit("git:refreshStatus");
    await loadWorkingTreeDiff();
  }
}

async function downloadFile(file) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  closeMenu();
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/download?path=${encodeURIComponent(file.path)}`);
    if (!res?.ok) { emit("toast:show", { message: "Download failed", type: "error" }); return; }
    const blob = await res.blob();
    triggerBlobDownload(blob, file.path.split("/").pop() || "download");
  } catch {
    emit("toast:show", { message: "Download failed", type: "error" });
  }
}

async function deleteFile(file) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  closeMenu();
  const { ok } = await apiCommand(
    wsEndpoint(workspace, "delete-file"),
    { path: file.path },
    { errorMessage: "Delete failed" },
  );
  if (ok) {
    emit("toast:show", { message: "Deleted", type: "success" });
    emit("git:refreshStatus");
    await loadWorkingTreeDiff();
  }
}

async function loadWorkingTreeDiff() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  isLoading.value = true;
  isWorkingTree.value = true;
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
