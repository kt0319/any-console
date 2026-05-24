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
      <span v-if="showHistory" class="file-browser-crumb-badge">History</span>
      <span v-if="!props.diffFile" class="file-browser-header-actions">
        <template v-if="fileContent || showHistory">
          <button type="button" class="file-browser-header-btn" :aria-label="showHistory ? 'Show file' : 'Show history'" :data-tooltip="showHistory ? 'Show file' : 'Show history'" @click="toggleHistory"><span class="mdi" :class="showHistory ? 'mdi-file-document-outline' : 'mdi-history'" aria-hidden="true"></span></button>
        </template>
        <template v-else>
          <input ref="uploadInputEl" type="file" multiple class="file-browser-upload-input" @change="onUploadInputChange">
          <button type="button" class="file-browser-header-btn" :aria-label="showGitignored ? 'Hide gitignored files' : 'Show gitignored files'" :data-tooltip="showGitignored ? 'Hide gitignored files' : 'Show gitignored files'" @click="showGitignored = !showGitignored"><span class="mdi" :class="showGitignored ? 'mdi-eye-outline' : 'mdi-eye-off-outline'" aria-hidden="true"></span></button>
          <button v-if="editorUrlTemplate" type="button" class="file-browser-header-btn" aria-label="Open in editor" data-tooltip="Open in editor" @click="openDirInEditor"><span class="mdi mdi-file-edit-outline" aria-hidden="true"></span></button>
          <button type="button" class="file-browser-header-btn" aria-label="Upload files" data-tooltip="Upload files" @click="uploadInputEl?.click()"><span class="mdi mdi-upload" aria-hidden="true"></span></button>
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

      <FileHistoryPane v-else-if="showHistory" :filePath="currentPath" />

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
              :size-text="entrySizeText(entry)"
              :mtime-text="formatRelativeTime(entry.mtime)"
              @click="onEntryClick(entry)"
              @contextmenu="toggleContextMenu(entry)"
              @mouseenter="onItemMouseEnter(entry)"
              @mouseleave="onItemMouseLeave"
              @mousedown="onLongPressStart($event, entry)"
              @mouseup="onLongPressEnd"
              @touchstart="onLongPressStart($event, entry)"
              @touchend="onLongPressEnd"
              @touchcancel="onLongPressEnd"
            />
            <FileContextMenu
              v-if="contextEntry?.name === entry.name"
              :is-file="entry.type === 'file'"
              :github-url="githubEntryUrl"
              @open="openEntry(entry)"
              @editor="openEntryInEditor"
              @history="openEntryHistory"
              @download="downloadEntry"
              @github="openGitHub"
              @rename="renameEntry"
              @move="moveEntry"
              @delete="deleteEntry"
              @menu-enter="onMenuMouseEnter"
              @menu-leave="onMenuMouseLeave"
            />
          </template>
        </ul>
        <div v-if="entries.length === 0" class="file-content-message">No files</div>
      </template>

      <FileTextViewer v-else :fileContent="fileContent" :fileName="currentPath" />
    </template>
  </div>
</template>

<script setup>
import { computed, ref, toRef, watch, onMounted, onBeforeUnmount } from "vue";
import FileTextViewer from "./FileTextViewer.vue";
import FileHistoryPane from "./FileHistoryPane.vue";
import FileItem from "./FileItem.vue";
import FileContextMenu from "./FileContextMenu.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useFileDragDrop } from "../composables/useFileDragDrop.js";
import { useFileActions } from "../composables/useFileActions.js";
import { useEditorIntegration } from "../composables/useEditorIntegration.js";
import { useFileDiff } from "../composables/useFileDiff.js";
import { useFileBrowserNav } from "../composables/useFileBrowserNav.js";
import { useShowGitignored } from "../composables/useShowGitignored.js";
import { emit } from "../app-bridge.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useHoverMenu, isHoverDevice } from "../composables/useHoverMenu.js";
import { renderFileIcon } from "../utils/file-icon.js";
import { formatSize, formatRelativeTime } from "../utils/format.js";

const workspaceStore = useWorkspaceStore();

const props = defineProps({
  diffFile: { type: String, default: "" },
  diffMessage: { type: String, default: "" },
});

const {
  currentPath, entries, fileContent,
  isLoading: isFileBrowserLoading, errorMessage: fileBrowserError, showHistory,
  navigateToPath, openFile, toggleHistory,
} = useFileBrowserNav();
const {
  contextEntry,
  openMenu: openContextMenu, closeMenu: closeContextMenu,
  onItemMouseEnter, onItemMouseLeave,
  onMenuMouseEnter, onMenuMouseLeave,
} = useHoverMenu();
const uploadInputEl = ref(null);
const { showGitignored } = useShowGitignored(toRef(workspaceStore, "selectedWorkspace"));

function entrySizeText(entry) {
  if (entry.type === "file" && entry.size != null) return formatSize(entry.size);
  if (entry.type === "dir" && entry.count != null) {
    return entry.count === 1 ? "1 item" : `${entry.count} items`;
  }
  return "";
}

const {
  renameEntry, moveEntry, deleteEntry,
  downloadEntry,
  uploadDroppedFiles,
} = useFileActions({
  getContextEntry: () => contextEntry.value,
  clearContextEntry: () => { closeContextMenu(); },
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
  if (showGitignored.value) return entries.value;
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

const longPress = useLongPress();

function onLongPressStart(e, entry) {
  if (isHoverDevice) return;
  longPress.startMenu(e, entry);
}

function onLongPressEnd() {
  if (isHoverDevice) return;
  longPress.endMenu();
  if (longPress.activeEntry.value && longPress.activeEntry.value !== contextEntry.value) {
    contextEntry.value = longPress.activeEntry.value;
    longPress.activeEntry.value = null;
  }
}

function toggleContextMenu(entry) {
  if (contextEntry.value?.name === entry.name) closeContextMenu();
  else openContextMenu(entry);
}

function openGitHub() {
  if (githubEntryUrl.value) {
    window.open(githubEntryUrl.value, "_blank");
  }
  closeContextMenu();
}

function openEntry(entry) {
  closeContextMenu();
  const childPath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
  if (entry.type === "dir") {
    navigateToPath(childPath);
  } else if (entry.type === "file") {
    currentPath.value = childPath;
    openFile(childPath);
  }
}

function openEntryHistory() {
  const entry = contextEntry.value;
  if (!entry || entry.type !== "file") return;
  const filePath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
  closeContextMenu();
  currentPath.value = filePath;
  fileContent.value = null;
  showHistory.value = true;
}

function openEntryInEditor() {
  const entry = contextEntry.value;
  if (!entry) return;
  const filePath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
  closeContextMenu();
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
  if (!isHoverDevice) {
    if (contextEntry.value?.name === entry.name) {
      closeContextMenu();
      const childPath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
      if (entry.type === "dir") navigateToPath(childPath);
      else if (entry.type === "file") { currentPath.value = childPath; openFile(childPath); }
    } else {
      toggleContextMenu(entry);
    }
    return;
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

const fileBrowserEmit = defineEmits(["state"]);

watch(
  [currentPath, fileContent, showHistory],
  () => {
    fileBrowserEmit("state", {
      atRoot: !currentPath.value,
      fileOpen: !!(fileContent.value || showHistory.value),
    });
  },
  { immediate: true },
);

defineExpose({ load: () => navigateToPath(""), navigateToPath });
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
