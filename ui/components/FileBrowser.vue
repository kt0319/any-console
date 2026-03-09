<template>
  <div class="file-browser">
    <div class="file-browser-header">
      <button class="file-browser-crumb" @click="navigate('')">root</button>
      <template v-for="(seg, i) in pathSegments" :key="i">
        <span class="file-browser-crumb-sep">/</span>
        <button
          v-if="i < pathSegments.length - 1"
          class="file-browser-crumb"
          @click="navigate(pathSegments.slice(0, i + 1).join('/'))"
        >{{ seg }}</button>
        <span v-else class="file-browser-crumb-current">{{ seg }}</span>
      </template>
    </div>

    <div v-if="loading" class="file-content-message">読み込み中...</div>
    <div v-else-if="error" class="file-content-message">{{ error }}</div>

    <template v-else-if="!fileContent">
      <ul class="file-browser-list">
        <template v-for="entry in entries" :key="entry.name">
          <li
            class="file-browser-item"
            :class="{ 'action-open': contextEntry?.name === entry.name }"
            :data-type="entry.type"
            @click="onEntryClick(entry)"
            @contextmenu.prevent="toggleContextMenu(entry)"
            @touchstart.passive="onLongPressStart($event, entry)"
            @touchend="onLongPressEnd"
            @touchcancel="onLongPressEnd"
          >
            <span
              class="file-browser-item-icon"
              :class="{
                'dir-icon': entry.type === 'dir',
                'file-icon': entry.type === 'file',
                'symlink-icon': entry.type === 'symlink',
              }"
            >{{ entryIcon(entry) }}</span>
            <span class="file-browser-item-name" :class="{ dimmed: entry.gitignored }">{{ entry.name }}</span>
            <span v-if="entry.type === 'file' && entry.size != null" class="file-browser-item-size">{{ formatSize(entry.size) }}</span>
          </li>
          <li v-if="contextEntry?.name === entry.name" class="file-browser-action-menu">
            <button v-if="entry.type === 'file'" type="button" @click="downloadEntry"><span class="mdi mdi-download"></span> ダウンロード</button>
            <button type="button" @click="renameEntry"><span class="mdi mdi-rename-box"></span> リネーム</button>
            <button type="button" @click="moveEntry"><span class="mdi mdi-file-move-outline"></span> 移動</button>
            <button type="button" class="file-browser-action-delete" @click="deleteEntry"><span class="mdi mdi-delete-outline"></span> 削除</button>
            <button type="button" @click="contextEntry = null"><span class="mdi mdi-close"></span></button>
          </li>
        </template>
      </ul>
      <div v-if="entries.length === 0" class="file-content-message">ファイルがありません</div>
    </template>

    <FileViewer v-else :fileContent="fileContent" :fileName="currentPath" />
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import FileViewer from "./FileViewer.vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();

const currentPath = ref("");
const entries = ref([]);
const fileContent = ref(null);
const loading = ref(false);
const error = ref("");
const contextEntry = ref(null);

const pathSegments = computed(() => {
  if (!currentPath.value) return [];
  return currentPath.value.split("/").filter(Boolean);
});

function entryIcon(entry) {
  if (entry.type === "dir") return "\u{1F4C1}";
  if (entry.type === "symlink") return "\u{1F517}";
  return "\u{1F4C4}";
}

function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function load() {
  await navigate("");
}

async function navigate(path) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;

  currentPath.value = path;
  fileContent.value = null;
  loading.value = true;
  error.value = "";

  try {
    const res = await auth.apiFetch(
      `/workspaces/${encodeURIComponent(workspace)}/files?path=${encodeURIComponent(path)}`
    );
    if (!res || !res.ok) {
      error.value = "読み込みに失敗しました";
      return;
    }
    const data = await res.json();
    entries.value = data.entries || [];
  } catch (e) {
    error.value = "読み込みに失敗しました";
    console.error("FileBrowser navigate failed:", e);
  } finally {
    loading.value = false;
  }
}

async function openFile(path) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;

  loading.value = true;
  error.value = "";

  try {
    const res = await auth.apiFetch(
      `/workspaces/${encodeURIComponent(workspace)}/file-content?path=${encodeURIComponent(path)}`
    );
    if (!res || !res.ok) {
      error.value = "ファイルを開けませんでした";
      return;
    }
    fileContent.value = await res.json();
  } catch (e) {
    error.value = "ファイルを開けませんでした";
    console.error("FileBrowser openFile failed:", e);
  } finally {
    loading.value = false;
  }
}

let longPressTimer = null;
let longPressTriggered = false;

function onLongPressStart(e, entry) {
  longPressTriggered = false;
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    contextEntry.value = entry;
  }, 500);
}

function onLongPressEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
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
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src, dest }),
    });
    if (!res || !res.ok) {
      emit("toast:show", { message: "リネームに失敗しました", type: "error" });
      return;
    }
    emit("toast:show", { message: "リネームしました", type: "success" });
    await navigate(currentPath.value);
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
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/delete-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    if (!res || !res.ok) {
      emit("toast:show", { message: "削除に失敗しました", type: "error" });
      return;
    }
    emit("toast:show", { message: "削除しました", type: "success" });
    await navigate(currentPath.value);
  } catch (e) {
    emit("toast:show", { message: e.message, type: "error" });
  }
}

async function downloadEntry() {
  const filePath = entryPath();
  if (!filePath) return;
  contextEntry.value = null;
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
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

function onEntryClick(entry) {
  if (longPressTriggered) { longPressTriggered = false; return; }
  if (contextEntry.value) return;
  const childPath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
  if (entry.type === "dir") {
    navigate(childPath);
  } else if (entry.type === "file") {
    currentPath.value = childPath;
    openFile(childPath);
  }
}

defineExpose({ load });
</script>
