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
      <span v-if="props.diffFile" class="file-browser-crumb-badge">(差分)</span>
      <span class="file-browser-header-actions">
        <template v-if="props.diffFile || fileContent">
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
      <div v-if="isFileBrowserLoading" class="file-content-message">読み込み中...</div>
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
              <button v-if="entry.type === 'file'" type="button" @click="openEntryInEditor"><span class="mdi mdi-file-edit-outline"></span> エディタ</button>
              <button v-if="entry.type === 'file'" type="button" @click="downloadEntry"><span class="mdi mdi-download"></span> ダウンロード</button>
              <button v-if="githubEntryUrl" type="button" @click="openGitHub"><span class="mdi mdi-github"></span> GitHub</button>
              <button type="button" @click="renameEntry"><span class="mdi mdi-rename-box"></span> リネーム</button>
              <button type="button" @click="moveEntry"><span class="mdi mdi-file-move-outline"></span> 移動</button>
              <button type="button" class="file-browser-action-delete" @click="deleteEntry"><span class="mdi mdi-delete-outline"></span> 削除</button>
            </li>
          </template>
        </ul>
        <div v-if="entries.length === 0" class="file-content-message">ファイルがありません</div>
      </template>

      <FileTextViewer v-else :fileContent="fileContent" :fileName="currentPath" />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import FileTextViewer from "./FileTextViewer.vue";
import FileItem from "./FileItem.vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { useApi } from "../composables/useApi.js";
import { useFileDragDrop } from "../composables/useFileDragDrop.js";
import { emit } from "../app-bridge.js";
import { useLongPress } from "../composables/useLongPress.js";
import { MSG_DELETE_FAILED } from "../utils/constants.js";
import { renderFileIcon } from "../utils/file-icon.js";
import { formatSize } from "../utils/format.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const { apiGet, apiPost, wsEndpoint } = useApi();
const gitStore = useGitStore();

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
const diffHtml = ref("");
const diffNewFileContent = ref(null);
const uploadInputEl = ref(null);
const editorUrlTemplate = ref("");
const systemInfo = ref({});
const showIgnored = ref(false);

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

const DIFF_COLORS = {
  "+": "var(--diff-add, #9ece6a)",
  "-": "var(--diff-del, #f7768e)",
  "@": "var(--diff-hunk, #7aa2f7)",
};

function escapeDiffHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function colorDiff(text) {
  if (!text) return "";
  return text.split("\n").map((line) => {
    const prefix = line[0];
    const color = DIFF_COLORS[prefix];
    if (color) return `<span style="color:${color}">${escapeDiffHtml(line)}</span>`;
    return escapeDiffHtml(line);
  }).join("\n");
}

watch(() => props.diffFile, async (file) => {
  diffNewFileContent.value = null;
  if (!file) { diffHtml.value = ""; return; }
  const chunk = gitStore.diffChunks[file];
  if (chunk) {
    diffHtml.value = `<pre>${colorDiff(chunk)}</pre>`;
    return;
  }
  const status = (gitStore.diffFileStatuses[file] || "").trim();
  if (status === "??" || status === "A") {
    const workspace = workspaceStore.selectedWorkspace;
    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, `file-content?path=${encodeURIComponent(file)}`));
      if (ok && data) {
        diffNewFileContent.value = data;
        diffHtml.value = "";
        return;
      }
    } catch {}
  }
  diffHtml.value = "";
}, { immediate: true });

watch(() => props.diffMessage, (msg) => {
  if (msg) {
    diffHtml.value = `<div class="text-muted-center">${escapeDiffHtml(msg)}</div>`;
  }
}, { immediate: true });

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
      fileBrowserError.value = "読み込みに失敗しました";
      return;
    }
    entries.value = data.entries || [];
  } catch (e) {
    fileBrowserError.value = "読み込みに失敗しました";
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
      fileBrowserError.value = "ファイルを開けませんでした";
      return;
    }
    fileContent.value = data;
  } catch (e) {
    fileBrowserError.value = "ファイルを開けませんでした";
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

function entryPath() {
  if (!contextEntry.value) return "";
  return currentPath.value ? `${currentPath.value}/${contextEntry.value.name}` : contextEntry.value.name;
}

function openGitHub() {
  if (githubEntryUrl.value) {
    window.open(githubEntryUrl.value, "_blank");
  }
  contextEntry.value = null;
}

async function renameEntry() {
  const filePath = entryPath();
  const fileName = contextEntry.value?.name;
  if (!filePath || !fileName) return;
  const newName = prompt("新しい名前:", fileName);
  if (!newName || newName === fileName) { contextEntry.value = null; return; }
  const parentPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
  const destPath = parentPath ? `${parentPath}/${newName}` : newName;
  contextEntry.value = null;
  await renameFile(filePath, destPath);
}

async function moveEntry() {
  const filePath = entryPath();
  if (!filePath) return;
  const destPath = prompt("移動先パス:", filePath);
  if (!destPath || destPath === filePath) { contextEntry.value = null; return; }
  contextEntry.value = null;
  await renameFile(filePath, destPath);
}

async function renameFile(src, dest) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  try {
    const { ok } = await apiPost(wsEndpoint(workspace, "rename"), { src, dest });
    if (!ok) {
      emit("toast:show", { message: "リネームに失敗しました", type: "error" });
      return;
    }
    emit("toast:show", { message: "リネームしました", type: "success" });
    await navigateToPath(currentPath.value);
  } catch (e) {
    emit("toast:show", { message: e.message, type: "error" });
  }
}

async function deleteEntry() {
  const filePath = entryPath();
  const fileName = contextEntry.value?.name;
  if (!filePath || !fileName) return;
  if (!confirm(`「${fileName}」を削除しますか？`)) { contextEntry.value = null; return; }
  contextEntry.value = null;
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  try {
    const { ok } = await apiPost(wsEndpoint(workspace, "delete-file"), { path: filePath });
    if (!ok) {
      emit("toast:show", { message: MSG_DELETE_FAILED, type: "error" });
      return;
    }
    emit("toast:show", { message: "削除しました", type: "success" });
    await navigateToPath(currentPath.value);
  } catch (e) {
    emit("toast:show", { message: e.message, type: "error" });
  }
}

async function downloadFile(filePath) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace || !filePath) return;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/download?path=${encodeURIComponent(filePath)}`);
    if (!res || !res.ok) {
      emit("toast:show", { message: "ダウンロードに失敗しました", type: "error" });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filePath.split("/").pop() || "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    emit("toast:show", { message: "ダウンロードに失敗しました", type: "error" });
  }
}

async function downloadEntry() {
  const filePath = entryPath();
  if (!filePath) return;
  contextEntry.value = null;
  await downloadFile(filePath);
}

function downloadCurrentFile() {
  const filePath = props.diffFile || currentPath.value;
  downloadFile(filePath);
}

async function fetchEditorSettings() {
  try {
    const [settingsResult, infoResult] = await Promise.all([
      apiGet("/settings/editor"),
      apiGet("/system/info"),
    ]);
    const settings = settingsResult.ok ? settingsResult.data : {};
    const info = infoResult.ok ? infoResult.data : {};
    editorUrlTemplate.value = (settings.url_template || "").trim();
    systemInfo.value = info;
  } catch {
    editorUrlTemplate.value = "";
  }
}

function buildEditorUrl(path) {
  const tmpl = editorUrlTemplate.value;
  if (!tmpl) return "";
  const workspace = workspaceStore.selectedWorkspace || "";
  let url = tmpl
    .replace(/\{user\}/g, systemInfo.value.user || "")
    .replace(/\{host\}/g, systemInfo.value.hostname || "")
    .replace(/\{work_dir\}/g, systemInfo.value.work_dir || "")
    .replace(/\{workspace\}/g, workspace);
  if (path) url += "/" + path;
  return url;
}

async function openEntryInEditor() {
  const filePath = entryPath();
  if (!filePath) return;
  contextEntry.value = null;
  if (!editorUrlTemplate.value) {
    currentPath.value = filePath;
    openFile(filePath);
    return;
  }
  window.open(buildEditorUrl(filePath), "_blank");
}

function openDirInEditor() {
  const url = buildEditorUrl(currentPath.value);
  if (url) window.open(url, "_blank");
}

function getUploadDirPath() {
  if (!fileContent.value) {
    return currentPath.value || "";
  }
  const idx = currentPath.value.lastIndexOf("/");
  if (idx <= 0) return "";
  return currentPath.value.slice(0, idx);
}

async function uploadDroppedFiles(files) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace || files.length === 0) return;
  const uploadPath = getUploadDirPath();
  let successCount = 0;
  let failCount = 0;
  for (const file of files) {
    const formData = new FormData();
    formData.append("path", uploadPath);
    formData.append("file", file);
    try {
      const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/upload`, {
        method: "POST",
        body: formData,
      });
      if (res && res.ok) {
        successCount += 1;
      } else {
        failCount += 1;
      }
    } catch {
      failCount += 1;
    }
  }

  if (successCount > 0) {
    emit("toast:show", { message: `${successCount}件アップロードしました`, type: "success" });
  }
  if (failCount > 0) {
    emit("toast:show", { message: `${failCount}件アップロードに失敗しました`, type: "error" });
  }
  await navigateToPath(uploadPath);
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
  content: "ここにドロップでアップロード";
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
