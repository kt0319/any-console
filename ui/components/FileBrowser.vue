<template>
  <div
    class="file-browser"
    :class="{ 'file-browser-drop-active': isDropActive }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDropFiles"
  >
    <div class="file-browser-header">
      <button class="file-browser-crumb" @click="onCrumbClick('')">{{ workspaceStore.selectedWorkspace || 'root' }}</button>
      <template v-for="(seg, i) in displayPathSegments" :key="i">
        <span class="file-browser-crumb-sep">/</span>
        <button
          v-if="props.diffFile || i < displayPathSegments.length - 1"
          class="file-browser-crumb"
          :class="{ 'file-browser-crumb-current-action': props.diffFile && i === displayPathSegments.length - 1 }"
          @click="onCrumbClick(displayPathSegments.slice(0, i + 1).join('/'))"
        >{{ seg }}</button>
        <span v-else class="file-browser-crumb-current">{{ seg }}</span>
      </template>
      <span v-if="props.diffFile" class="file-browser-crumb-badge">Diff</span>
      <span v-if="!props.diffFile" class="file-browser-header-actions">
        <template v-if="fileContent">
          <button type="button" class="file-browser-header-btn" @click="downloadCurrentFile"><span class="mdi mdi-download"></span></button>
        </template>
        <template v-else>
          <input ref="uploadInputEl" type="file" multiple class="file-browser-upload-input" @change="onUploadInputChange">
          <button type="button" class="file-browser-header-btn" @click="showIgnored = !showIgnored"><span class="mdi" :class="showIgnored ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"></span></button>
          <button v-if="editorUrlTemplate" type="button" class="file-browser-header-btn" @click="openDirInEditor"><span class="mdi mdi-file-edit-outline"></span></button>
          <button type="button" class="file-browser-header-btn" @click="uploadInputEl?.click()"><span class="mdi mdi-upload"></span></button>
        </template>
      </span>
    </div>

    <template v-if="diffFile">
      <div v-if="diffNewFileContent" class="diff-viewer-pane">
        <FileTextViewer :fileContent="diffNewFileContent" :fileName="diffFile" />
      </div>
      <div v-else class="diff-viewer-pane">
        <div class="diff-content" v-html="diffHtml"></div>
      </div>
    </template>

    <template v-else>
      <div v-if="isFileBrowserLoading" class="file-content-message">Loading...</div>
      <div v-else-if="fileBrowserError" class="file-content-message">{{ fileBrowserError }}</div>

      <template v-else-if="!fileContent">
        <ul class="file-browser-list">
          <template v-for="entry in visibleEntries" :key="entry.name">
            <FileItem
              long-press-surface
              :action-open="contextEntry?.name === entry.name"
              :gitignored="entry.gitignored"
              :data-type="entry.type"
              :label="entry.name"
              :icon-html="renderFileIcon(entry)"
              :size-text="entry.type === 'file' && entry.size != null ? formatSize(entry.size) : ''"
              @click="onEntryClick(entry)"
              @contextmenu="toggleContextMenu(entry)"
              @mousedown="onLongPressStart($event, entry)"
              @mouseup="onLongPressEnd"
              @mouseleave="onLongPressEnd"
              @touchstart="onLongPressStart($event, entry)"
              @touchend="onLongPressEnd"
              @touchcancel="onLongPressEnd"
            />
            <li v-if="contextEntry?.name === entry.name" class="file-browser-action-menu">
              <button v-if="entry.type === 'file'" type="button" @click="openEntryInEditor"><span class="mdi mdi-file-edit-outline"></span> Editor</button>
              <button v-if="entry.type === 'file'" type="button" @click="downloadEntry"><span class="mdi mdi-download"></span> Download</button>
              <button v-if="githubEntryUrl" type="button" @click="openGitHub"><span class="mdi mdi-github"></span> GitHub</button>
              <button type="button" @click="renameEntry"><span class="mdi mdi-rename-box"></span> Rename</button>
              <button type="button" @click="moveEntry"><span class="mdi mdi-file-move-outline"></span> Move</button>
              <button type="button" class="file-browser-action-delete" @click="deleteEntry"><span class="mdi mdi-delete-outline"></span> Delete</button>
            </li>
          </template>
        </ul>
        <div v-if="entries.length === 0" class="file-content-message">No files</div>
      </template>

      <FileTextViewer v-else :fileContent="fileContent" :fileName="currentPath" />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import FileTextViewer from "./FileTextViewer.vue";
import FileItem from "./FileItem.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useFileDragDrop } from "../composables/useFileDragDrop.js";
import { useFileActions } from "../composables/useFileActions.js";
import { useEditorIntegration } from "../composables/useEditorIntegration.js";
import { useFileDiff } from "../composables/useFileDiff.js";
import { emit } from "../app-bridge.js";
import { useLongPress } from "../composables/useLongPress.js";
import { renderFileIcon } from "../utils/file-icon.js";
import { formatSize } from "../utils/format.js";

const workspaceStore = useWorkspaceStore();
const { apiGet, wsEndpoint } = useApi();

const props = defineProps({
  diffFile: { type: String, default: "" },
  diffMessage: { type: String, default: "" },
});

const currentPath = ref("");
const entries = ref([]);
const fileContent = ref(null);
const isFileBrowserLoading = ref(false);
const fileBrowserError = ref("");
const contextEntry = ref(null);
const uploadInputEl = ref(null);
const showIgnored = ref(false);

const {
  renameEntry, moveEntry, deleteEntry,
  downloadFile, downloadEntry,
  uploadDroppedFiles,
} = useFileActions({
  getContextEntry: () => contextEntry.value,
  clearContextEntry: () => { contextEntry.value = null; },
  getCurrentPath: () => currentPath.value,
  getFileContent: () => fileContent.value,
  navigateToPath: (path) => navigateToPath(path),
});

const {
  editorUrlTemplate, fetchEditorSettings,
  buildEditorUrl, openInEditor,
} = useEditorIntegration();

const {
  diffHtml, diffNewFileContent,
} = useFileDiff({
  getDiffFile: () => props.diffFile,
  getDiffMessage: () => props.diffMessage,
});

const {
  isDropActive,
  onDragEnter, onDragOver, onDragLeave, onDropFiles,
  onWindowDrop, onWindowDragLeave,
  onUploadInputChange,
  setupWindowListeners, cleanupWindowListeners,
} = useFileDragDrop({
  uploadFn: (files) => uploadDroppedFiles(files),
  isDiffMode: () => !!props.diffFile,
});

const pathSegments = computed(() => {
  if (!currentPath.value) return [];
  return currentPath.value.split("/").filter(Boolean);
});

const visibleEntries = computed(() => {
  if (showIgnored.value) return entries.value;
  return entries.value.filter((e) => !e.gitignored);
});

const displayPathSegments = computed(() => {
  if (props.diffFile) return props.diffFile.split("/").filter(Boolean);
  return pathSegments.value;
});

const githubEntryUrl = computed(() => {
  const ws = workspaceStore.currentWorkspace;
  if (!ws?.github_url || !contextEntry.value) return "";
  const branch = ws.branch || "main";
  const entryPath = currentPath.value
    ? `${currentPath.value}/${contextEntry.value.name}`
    : contextEntry.value.name;
  const type = contextEntry.value.type === "dir" ? "tree" : "blob";
  return `${ws.github_url}/${type}/${branch}/${entryPath}`;
});

async function loadFileBrowserRoot() {
  await navigateToPath("");
}

async function navigateToPath(path) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;

  currentPath.value = path;
  fileContent.value = null;
  isFileBrowserLoading.value = true;
  fileBrowserError.value = "";

  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `files?path=${encodeURIComponent(path)}`));
    if (!ok) {
      fileBrowserError.value = "Failed to load";
      return;
    }
    entries.value = data.entries || [];
  } catch (e) {
    fileBrowserError.value = "Failed to load";
    console.error("FileBrowser navigate failed:", e);
  } finally {
    isFileBrowserLoading.value = false;
  }
}

async function openFile(path) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;

  isFileBrowserLoading.value = true;
  fileBrowserError.value = "";

  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `file-content?path=${encodeURIComponent(path)}`));
    if (!ok) {
      fileBrowserError.value = "Could not open file";
      return;
    }
    fileContent.value = data;
  } catch (e) {
    fileBrowserError.value = "Could not open file";
    console.error("FileBrowser openFile failed:", e);
  } finally {
    isFileBrowserLoading.value = false;
  }
}

const longPress = useLongPress();

function onLongPressStart(e, entry) {
  longPress.startMenu(e, entry);
}

function onLongPressEnd() {
  longPress.endMenu();
  if (longPress.activeEntry.value && longPress.activeEntry.value !== contextEntry.value) {
    contextEntry.value = longPress.activeEntry.value;
    longPress.activeEntry.value = null;
  }
}

function toggleContextMenu(entry) {
  if (contextEntry.value?.name === entry.name) {
    contextEntry.value = null;
  } else {
    contextEntry.value = entry;
  }
}

function openGitHub() {
  if (githubEntryUrl.value) {
    window.open(githubEntryUrl.value, "_blank");
  }
  contextEntry.value = null;
}

function openEntryInEditor() {
  const entry = contextEntry.value;
  if (!entry) return;
  const filePath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
  contextEntry.value = null;
  if (!editorUrlTemplate.value) {
    currentPath.value = filePath;
    openFile(filePath);
    return;
  }
  openInEditor(filePath);
}

function openDirInEditor() {
  openInEditor(currentPath.value);
}

function downloadCurrentFile() {
  const filePath = props.diffFile || currentPath.value;
  downloadFile(filePath);
}

function onCrumbClick(path) {
  if (props.diffFile) {
    emit("git:selectDirty");
    fileContent.value = null;
    currentPath.value = path || "";
    if (path && path === props.diffFile) {
      openFile(path);
      return;
    }
    navigateToPath(currentPath.value);
    return;
  }
  navigateToPath(path);
}

function onEntryClick(entry) {
  if (longPress.isMenuEl() || longPress.isFired()) {
    return;
  }
  if (contextEntry.value) {
    const wasContext = contextEntry.value.name === entry.name;
    contextEntry.value = null;
    if (wasContext) return;
  }
  const childPath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
  if (entry.type === "dir") {
    navigateToPath(childPath);
  } else if (entry.type === "file") {
    currentPath.value = childPath;
    openFile(childPath);
  }
}

onMounted(() => {
  setupWindowListeners();
  fetchEditorSettings();
});

onBeforeUnmount(() => {
  cleanupWindowListeners();
});

defineExpose({ load: loadFileBrowserRoot });
</script>

<style scoped>
.file-browser {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  background: transparent;
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.file-browser-header {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px 4px;
  font-size: 12px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.file-browser.file-browser-drop-active::after {
  content: "Drop files to upload";
  position: absolute;
  inset: 12px;
  border: 2px dashed var(--accent);
  border-radius: var(--radius);
  background: rgba(76, 175, 80, 0.08);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 16px;
  pointer-events: none;
  z-index: 2;
}

.file-browser-crumb {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 12px;
  padding: 1px 3px;
  cursor: pointer;
  font-family: inherit;
}

.file-browser-crumb-sep {
  color: var(--text-muted);
}

.file-browser-crumb-current {
  color: var(--text-primary);
  padding: 1px 3px;
}

.file-browser-crumb-current-action {
  display: inline-flex;
  align-items: center;
  padding: 1px 3px;
  border: none;
  background: transparent;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

.file-browser-upload-input {
  display: none;
}

.file-browser-header-btn {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 16px;
  padding: 4px 8px;
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
}

.file-browser-header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.file-browser-crumb-badge {
  margin-left: 4px;
  display: inline-flex;
  align-items: center;
  min-height: 16px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-muted);
  font-size: 9px;
  line-height: 1.2;
  white-space: nowrap;
}

.file-browser-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

.file-content-message {
  padding: 24px 16px;
  color: var(--text-muted);
  text-align: center;
  font-size: 13px;
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

.diff-viewer-pane {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.diff-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: auto;
  min-width: 0;
  background: transparent;
  padding: 12px;
  min-height: 100px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 11px;
  line-height: 1.5;
}
</style>
