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
      <span v-if="props.diffFile" class="file-browser-header-actions">
        <button type="button" class="file-browser-header-btn" aria-label="Show in Files" data-tooltip="Show in Files" @click="browseToDiffFolder"><span class="mdi mdi-folder-open-outline" aria-hidden="true"></span> Show in Files</button>
        <button v-if="showEditorButton" type="button" class="file-browser-header-btn" aria-label="Open in editor" data-tooltip="Open in editor" @click="openDiffFileInEditor"><span class="mdi mdi-file-edit-outline" aria-hidden="true"></span> Editor</button>
        <button v-if="diffGithubUrl" type="button" class="file-browser-header-btn" aria-label="GitHub" data-tooltip="GitHub" @click="openDiffFileGithub"><span class="mdi mdi-github" aria-hidden="true"></span> GitHub</button>
        <button v-if="props.diffIsWorkingTree" type="button" class="file-browser-header-btn file-browser-header-btn-delete" aria-label="Discard" data-tooltip="Discard" @click="discardDiffFile"><span class="mdi mdi-undo" aria-hidden="true"></span> Discard</button>
        <button v-if="props.diffIsWorkingTree" type="button" class="file-browser-header-btn file-browser-header-btn-delete" aria-label="Delete" data-tooltip="Delete" @click="deleteDiffFile"><span class="mdi mdi-delete-outline" aria-hidden="true"></span> Delete</button>
      </span>
      <span v-if="!props.diffFile" class="file-browser-header-actions">
        <template v-if="fileContent || showHistory">
          <button type="button" class="file-browser-header-btn" :aria-label="showHistory ? 'Show file' : 'Show history'" :data-tooltip="showHistory ? 'Show file' : 'Show history'" @click="toggleHistory"><span class="mdi" :class="showHistory ? 'mdi-file-document-outline' : 'mdi-history'" aria-hidden="true"></span> {{ showHistory ? 'Show file' : 'History' }}</button>
          <button v-if="showEditorButton" type="button" class="file-browser-header-btn" aria-label="Open in editor" data-tooltip="Open in editor" @click="openCurrentFileInEditor"><span class="mdi mdi-file-edit-outline" aria-hidden="true"></span> Editor</button>
          <button type="button" class="file-browser-header-btn" aria-label="Download" data-tooltip="Download" @click="downloadFile(currentPath)"><span class="mdi mdi-download" aria-hidden="true"></span> Download</button>
          <button v-if="openFileGithubUrl" type="button" class="file-browser-header-btn" aria-label="GitHub" data-tooltip="GitHub" @click="openCurrentFileGithub"><span class="mdi mdi-github" aria-hidden="true"></span> GitHub</button>
          <button type="button" class="file-browser-header-btn" aria-label="Rename or move" data-tooltip="Rename or move" @click="moveCurrentPath"><span class="mdi mdi-file-move-outline" aria-hidden="true"></span> Move</button>
          <button type="button" class="file-browser-header-btn file-browser-header-btn-delete" aria-label="Delete" data-tooltip="Delete" @click="deleteCurrentPath"><span class="mdi mdi-delete-outline" aria-hidden="true"></span> Delete</button>
        </template>
        <template v-else>
          <input ref="uploadInputEl" type="file" multiple class="file-browser-upload-input" @change="onUploadInputChange">
          <button type="button" class="file-browser-header-btn" :aria-label="showGitignored ? 'Hide gitignored files' : 'Show gitignored files'" :data-tooltip="showGitignored ? 'Hide gitignored files' : 'Show gitignored files'" @click="showGitignored = !showGitignored"><span class="mdi" :class="showGitignored ? 'mdi-eye-outline' : 'mdi-eye-off-outline'" aria-hidden="true"></span> {{ showGitignored ? 'Hide ignored' : 'Show ignored' }}</button>
          <button v-if="showEditorButton" type="button" class="file-browser-header-btn" aria-label="Open in editor" data-tooltip="Open in editor" @click="openDirInEditor"><span class="mdi mdi-file-edit-outline" aria-hidden="true"></span> Editor</button>
          <button type="button" class="file-browser-header-btn" aria-label="Upload files" data-tooltip="Upload files" @click="uploadInputEl?.click()"><span class="mdi mdi-upload" aria-hidden="true"></span> Upload</button>
          <template v-if="currentPath">
            <button type="button" class="file-browser-header-btn" aria-label="Download folder" data-tooltip="Download folder as zip" @click="downloadFile(currentPath)"><span class="mdi mdi-download" aria-hidden="true"></span> Download</button>
            <button type="button" class="file-browser-header-btn" aria-label="Rename or move" data-tooltip="Rename or move" @click="moveCurrentPath"><span class="mdi mdi-file-move-outline" aria-hidden="true"></span> Move</button>
            <button type="button" class="file-browser-header-btn file-browser-header-btn-delete" aria-label="Delete" data-tooltip="Delete" @click="deleteCurrentPath"><span class="mdi mdi-delete-outline" aria-hidden="true"></span> Delete</button>
          </template>
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
      <div :class="{ 'file-content-message': isFileBrowserLoading }" role="status" aria-live="polite">{{ isFileBrowserLoading ? "Loading..." : "" }}</div>
      <div :class="{ 'file-content-message': fileBrowserError }" role="alert">{{ fileBrowserError }}</div>

      <template v-if="!isFileBrowserLoading && !fileBrowserError">
        <FileHistoryPane v-if="showHistory" :filePath="currentPath" />

        <template v-else-if="!fileContent">
          <ul class="file-browser-list">
            <template v-for="entry in visibleEntries" :key="entry.name">
              <FileItem
                :gitignored="entry.gitignored"
                :data-type="entry.type"
                :label="entry.name"
                :icon-html="renderFileIcon(entry)"
                :size-text="entrySizeText(entry)"
                :mtime-text="formatRelativeTime(entry.mtime)"
                @click="onEntryClick(entry)"
              />
            </template>
          </ul>
          <div v-if="entries.length === 0" class="file-content-message">No files</div>
        </template>

        <FileTextViewer v-else :fileContent="fileContent" :fileName="currentPath" />
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, toRef, watch, onMounted, onBeforeUnmount } from "vue";
import FileTextViewer from "./FileTextViewer.vue";
import FileHistoryPane from "./FileHistoryPane.vue";
import FileItem from "./FileItem.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useFileDragDrop } from "../composables/useFileDragDrop.js";
import { useFileActions } from "../composables/useFileActions.js";
import { useEditorIntegration } from "../composables/useEditorIntegration.js";
import { useFileDiff } from "../composables/useFileDiff.js";
import { useFileBrowserNav } from "../composables/useFileBrowserNav.js";
import { useFileBrowserCrumbs } from "../composables/useFileBrowserCrumbs.js";
import { useFileEntryMenu } from "../composables/useFileEntryMenu.js";
import { useDiffFileHeaderActions } from "../composables/useDiffFileHeaderActions.js";
import { useShowGitignored } from "../composables/useShowGitignored.js";
import { useIsMobile } from "../composables/useIsMobile.js";
import { renderFileIcon } from "../utils/file-icon.js";
import { formatRelativeTime } from "../utils/format.js";
import { entrySizeText } from "../utils/file-browser.js";

const workspaceStore = useWorkspaceStore();

const props = defineProps({
  diffFile: { type: String, default: "" },
  diffMessage: { type: String, default: "" },
  diffIsWorkingTree: { type: Boolean, default: false },
  diffCommitHash: { type: String, default: "" },
  rootLabel: { type: String, default: "" },
  terminalSessionId: { type: String, default: "" },
});

const {
  currentPath, entries, fileContent,
  isLoading: isFileBrowserLoading, errorMessage: fileBrowserError, showHistory,
  navigateToPath, openFile, toggleHistory,
} = useFileBrowserNav({ getTerminalSessionId: () => props.terminalSessionId });
const uploadInputEl = ref(null);
const { showGitignored } = useShowGitignored(toRef(workspaceStore, "selectedWorkspace"));

const {
  downloadFile,
  moveCurrentPath, deleteCurrentPath,
  uploadDroppedFiles,
} = useFileActions({
  getCurrentPath: () => currentPath.value,
  getFileContent: () => fileContent.value,
  navigateToPath: (path) => navigateToPath(path),
});

const {
  editorUrlTemplate, fetchEditorSettings,
  buildEditorUrl, openInEditor,
} = useEditorIntegration();

// エディタ連携（vscode://等のカスタムURLスキーム）はローカルのデスクトップ
// エディタを起動する前提のため、モバイルでは対応するアプリが無く実質使えない
// （useEditorIntegration.openInEditor参照）。ボタン自体を出さない。
const { isMobile } = useIsMobile();
const showEditorButton = computed(() => !!editorUrlTemplate.value && !isMobile.value);

const {
  diffHtml, diffNewFileContent,
} = useFileDiff({
  getDiffFile: () => props.diffFile,
  getDiffMessage: () => props.diffMessage,
});

const {
  githubUrl: diffGithubUrl, openGithub: openDiffFileGithub, openEditor: openDiffFileInEditor,
  browseToFolder: browseToDiffFolder,
  discard: discardDiffFile, deleteFile: deleteDiffFile,
} = useDiffFileHeaderActions({
  filePath: computed(() => props.diffFile),
  isWorkingTree: computed(() => props.diffIsWorkingTree),
  commitHash: computed(() => props.diffCommitHash),
  editorUrlTemplate,
  openInEditor,
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
  openDirInEditor,
  openFileGithubUrl, openCurrentFileGithub, openCurrentFileInEditor,
  onEntryClick,
} = useFileEntryMenu({
  currentPath, fileContent,
  navigateToPath, openFile,
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
  white-space: nowrap;
}

.file-browser-header-btn .mdi {
  font-size: 16px;
}

.file-browser-header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

@media (max-width: 767px) {
  .file-browser-header-actions {
    flex-basis: 100%;
    margin-left: 0;
    justify-content: flex-end;
    margin-top: 4px;
  }
}

.file-browser-header-btn-delete {
  color: var(--error);
  border-color: var(--error);
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
