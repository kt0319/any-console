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
      <span class="file-browser-header-actions">
        <input v-if="!props.diffFile && !fileContent && !showHistory" ref="uploadInputEl" type="file" multiple class="file-browser-upload-input" @change="onUploadInputChange">
        <button
          v-for="action in headerActions"
          :key="action.ariaLabel"
          type="button"
          class="file-browser-header-btn"
          :class="{ 'file-browser-header-btn-delete': action.danger }"
          :aria-label="action.ariaLabel"
          :data-tooltip="action.tooltip || action.ariaLabel"
          @click="action.onClick"
        ><span class="mdi" :class="action.icon" aria-hidden="true"></span> {{ action.label }}</button>
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

<script setup lang="ts">
import { computed, ref, toRef, watch, onMounted, onBeforeUnmount, type ComputedRef } from "vue";
import FileTextViewer from "./FileTextViewer.vue";
import FileHistoryPane from "./FileHistoryPane.vue";
import FileItem from "./FileItem.vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useFileDragDrop } from "../composables/useFileDragDrop.ts";
import { useFileActions } from "../composables/useFileActions.ts";
import { useEditorIntegration } from "../composables/useEditorIntegration.ts";
import { useFileDiff } from "../composables/useFileDiff.ts";
import { useFileBrowserNav } from "../composables/useFileBrowserNav.ts";
import { useFileBrowserCrumbs } from "../composables/useFileBrowserCrumbs.ts";
import { useFileEntryMenu } from "../composables/useFileEntryMenu.ts";
import { useDiffFileHeaderActions } from "../composables/useDiffFileHeaderActions.ts";
import { useShowGitignored } from "../composables/useShowGitignored.ts";
import { useIsMobile } from "../composables/useIsMobile.ts";
import { renderFileIcon } from "../utils/file-icon.ts";
import { formatRelativeTime } from "../utils/format.ts";
import { entrySizeText } from "../utils/file-browser.ts";

const workspaceStore = useWorkspaceStore();

const props = defineProps({
  diffFile: { type: String, default: "" },
  diffMessage: { type: String, default: "" },
  diffIsWorkingTree: { type: Boolean, default: false },
  diffCommitHash: { type: String, default: "" },
  rootLabel: { type: String, default: "" },
  terminalSessionId: { type: String, default: "" },
});

// useFileBrowserNav の entries は Record<string, any>[]。テンプレート
// （renderFileIcon / onEntryClick 等）で必要な形をここで確定させる。
interface FileEntry {
  name: string;
  type: "file" | "dir";
  gitignored?: boolean;
  mtime?: number;
  [key: string]: any;
}

const {
  currentPath, entries, fileContent,
  isLoading: isFileBrowserLoading, errorMessage: fileBrowserError, showHistory,
  navigateToPath, openFile, toggleHistory,
} = useFileBrowserNav({ getTerminalSessionId: () => props.terminalSessionId });
const uploadInputEl = ref<HTMLInputElement | null>(null);
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
  getDiffCommitHash: () => props.diffCommitHash,
});

const {
  githubUrl: diffGitHubUrl, openGitHub: openDiffFileGitHub, openEditor: openDiffFileInEditor,
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

const visibleEntries = computed<FileEntry[]>(() => {
  const all = entries.value as FileEntry[];
  if (showGitignored.value) return all;
  return all.filter((e) => !e.gitignored);
});
const rootLabel = computed(() => props.rootLabel || workspaceStore.selectedWorkspace || "root");

const {
  displayPathSegments: rawDisplayPathSegments, onCrumbClick,
} = useFileBrowserCrumbs({
  getDiffFile: () => props.diffFile,
  currentPath, fileContent,
  navigateToPath, openFile,
});
// splitPathSegments（utils/file-browser.ts）が未型付けのため any になっている。
// テンプレート（v-for のインデックス比較）で使う型をここで確定させる。
const displayPathSegments = rawDisplayPathSegments as ComputedRef<string[]>;

const {
  openDirInEditor,
  openFileGitHubUrl, openCurrentFileGitHub, openCurrentFileInEditor,
  onEntryClick,
} = useFileEntryMenu({
  currentPath, fileContent,
  navigateToPath, openFile,
  editorUrlTemplate, openInEditor,
});

// ヘッダーアクション（Editor/GitHub/Download/Move/Delete等）は diff表示・
// ファイル表示・ディレクトリ表示で同じボタンが重複するため、宣言的な配列に
// して v-for で描画する（モードごとの差分は配列の組み立てだけに現れる）。
interface HeaderAction {
  icon: string;
  label: string;
  ariaLabel: string;
  tooltip?: string;
  danger?: boolean;
  onClick: () => void | Promise<void>;
}

const editorAction = (onClick: () => void | Promise<void>): HeaderAction => ({ icon: "mdi-file-edit-outline", label: "Editor", ariaLabel: "Open in editor", onClick });
const githubAction = (onClick: () => void | Promise<void>): HeaderAction => ({ icon: "mdi-github", label: "GitHub", ariaLabel: "GitHub", onClick });
const moveAction = (): HeaderAction => ({ icon: "mdi-file-move-outline", label: "Move", ariaLabel: "Rename or move", onClick: moveCurrentPath });
const deleteAction = (onClick: () => void | Promise<void>): HeaderAction => ({ icon: "mdi-delete-outline", label: "Delete", ariaLabel: "Delete", danger: true, onClick });

const headerActions = computed<HeaderAction[]>(() => {
  if (props.diffFile) {
    return [
      { icon: "mdi-folder-open-outline", label: "Show in Files", ariaLabel: "Show in Files", onClick: browseToDiffFolder },
      ...(showEditorButton.value ? [editorAction(openDiffFileInEditor)] : []),
      ...(diffGitHubUrl.value ? [githubAction(openDiffFileGitHub)] : []),
      ...(props.diffIsWorkingTree
        ? [
            { icon: "mdi-undo", label: "Discard", ariaLabel: "Discard", danger: true, onClick: discardDiffFile },
            deleteAction(deleteDiffFile),
          ]
        : []),
    ];
  }
  if (fileContent.value || showHistory.value) {
    return [
      {
        icon: showHistory.value ? "mdi-file-document-outline" : "mdi-history",
        label: showHistory.value ? "Show file" : "History",
        ariaLabel: showHistory.value ? "Show file" : "Show history",
        onClick: toggleHistory,
      },
      ...(showEditorButton.value ? [editorAction(openCurrentFileInEditor)] : []),
      { icon: "mdi-download", label: "Download", ariaLabel: "Download", onClick: () => downloadFile(currentPath.value) },
      ...(openFileGitHubUrl.value ? [githubAction(openCurrentFileGitHub)] : []),
      moveAction(),
      deleteAction(deleteCurrentPath),
    ];
  }
  return [
    {
      icon: showGitignored.value ? "mdi-eye-outline" : "mdi-eye-off-outline",
      label: showGitignored.value ? "Hide ignored" : "Show ignored",
      ariaLabel: showGitignored.value ? "Hide gitignored files" : "Show gitignored files",
      onClick: () => { showGitignored.value = !showGitignored.value; },
    },
    ...(showEditorButton.value ? [editorAction(openDirInEditor)] : []),
    { icon: "mdi-upload", label: "Upload", ariaLabel: "Upload files", onClick: () => uploadInputEl.value?.click() },
    { icon: "mdi-download", label: "Download", ariaLabel: "Download folder", tooltip: "Download folder as zip", onClick: () => downloadFile(currentPath.value) },
    ...(currentPath.value
      ? [
          moveAction(),
          deleteAction(deleteCurrentPath),
        ]
      : []),
  ];
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

@media (max-width: 768px) {
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
