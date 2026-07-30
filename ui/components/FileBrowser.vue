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
      <button class="file-browser-crumb" @click="onCrumbClick('')">{{ rootLabel }}</button>
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
          <button v-if="editorUrlTemplate" type="button" class="file-browser-header-btn" aria-label="Open in editor" data-tooltip="Open in editor" @click="openCurrentFileInEditor"><span class="mdi mdi-file-edit-outline" aria-hidden="true"></span></button>
          <button type="button" class="file-browser-header-btn" aria-label="Download" data-tooltip="Download" @click="downloadFile(currentPath)"><span class="mdi mdi-download" aria-hidden="true"></span></button>
          <button v-if="openFileGithubUrl" type="button" class="file-browser-header-btn" aria-label="GitHub" data-tooltip="GitHub" @click="openCurrentFileGithub"><span class="mdi mdi-github" aria-hidden="true"></span></button>
          <button type="button" class="file-browser-header-btn" aria-label="Rename" data-tooltip="Rename" @click="renameOpenFile"><span class="mdi mdi-rename-box" aria-hidden="true"></span></button>
          <button type="button" class="file-browser-header-btn" aria-label="Move" data-tooltip="Move" @click="moveOpenFile"><span class="mdi mdi-file-move-outline" aria-hidden="true"></span></button>
          <button type="button" class="file-browser-header-btn file-browser-header-btn-delete" aria-label="Delete" data-tooltip="Delete" @click="deleteOpenFile"><span class="mdi mdi-delete-outline" aria-hidden="true"></span></button>
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
              :action-open="contextEntry?.name === entry.name"
              :gitignored="entry.gitignored"
              :data-type="entry.type"
              :label="entry.name"
              :icon-html="renderFileIcon(entry)"
              :size-text="entrySizeText(entry)"
              :mtime-text="formatRelativeTime(entry.mtime)"
              @click="onEntryClick(entry)"
              @contextmenu="entry.type === 'dir' && toggleContextMenu(entry)"
            >
              <template v-if="entry.type === 'dir'" #right>
                <button
                  type="button"
                  class="file-browser-item-actions-btn"
                  aria-label="Folder actions"
                  data-tooltip="Folder actions"
                  @click.stop="toggleContextMenu(entry)"
                >
                  <span class="mdi mdi-dots-vertical"></span>
                </button>
              </template>
            </FileItem>
            <FileContextMenu
              v-if="contextEntry?.name === entry.name"
              :is-file="false"
              :github-url="githubEntryUrl"
              @open="openEntry(entry)"
              @github="openGitHub"
              @rename="renameEntry"
              @move="moveEntry"
              @delete="deleteEntry"
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
import { useFileBrowserCrumbs } from "../composables/useFileBrowserCrumbs.js";
import { useFileEntryMenu } from "../composables/useFileEntryMenu.js";
import { useShowGitignored } from "../composables/useShowGitignored.js";
import { useHoverMenu } from "../composables/useHoverMenu.js";
import { renderFileIcon } from "../utils/file-icon.js";
import { formatRelativeTime } from "../utils/format.js";
import { entrySizeText } from "../utils/file-browser.js";

const workspaceStore = useWorkspaceStore();

const props = defineProps({
  diffFile: { type: String, default: "" },
  diffMessage: { type: String, default: "" },
  rootLabel: { type: String, default: "" },
  terminalSessionId: { type: String, default: "" },
});

const {
  currentPath, entries, fileContent,
  isLoading: isFileBrowserLoading, errorMessage: fileBrowserError, showHistory,
  navigateToPath, openFile, toggleHistory,
} = useFileBrowserNav({ getTerminalSessionId: () => props.terminalSessionId });
const {
  contextEntry,
  openMenu: openContextMenu, closeMenu: closeContextMenu,
} = useHoverMenu();
const uploadInputEl = ref(null);
const { showGitignored } = useShowGitignored(toRef(workspaceStore, "selectedWorkspace"));

const {
  renameEntry, moveEntry, deleteEntry,
  downloadEntry, downloadFile,
  renameOpenFile, moveOpenFile, deleteOpenFile,
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

const visibleEntries = computed(() => {
  if (showGitignored.value) return entries.value;
  return entries.value.filter((e) => !e.gitignored);
});
const rootLabel = computed(() => props.rootLabel || workspaceStore.selectedWorkspace || "root");

const {
  displayPathSegments, onCrumbClick,
} = useFileBrowserCrumbs({
  getDiffFile: () => props.diffFile,
  currentPath, fileContent,
  navigateToPath, openFile,
});

const {
  githubEntryUrl,
  toggleContextMenu,
  openGitHub,
  openEntry, openDirInEditor,
  openFileGithubUrl, openCurrentFileGithub, openCurrentFileInEditor,
  onEntryClick,
} = useFileEntryMenu({
  currentPath, fileContent,
  navigateToPath, openFile,
  contextEntry, openContextMenu, closeContextMenu,
  editorUrlTemplate, openInEditor,
});

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

.file-browser-header-btn-delete {
  color: var(--error);
  border-color: var(--error);
}

.file-browser-item-actions-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  min-width: 32px;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .file-browser-item-actions-btn:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }
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
