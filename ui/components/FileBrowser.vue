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
    </div>

    <template v-if="diffFile">
      <div class="diff-viewer-pane">
        <div class="diff-content" v-html="diffHtml"></div>
      </div>
    </template>

    <template v-else>
      <div v-if="loading" class="file-content-message">読み込み中...</div>
      <div v-else-if="error" class="file-content-message">{{ error }}</div>

      <template v-else-if="!fileContent">
        <ul class="file-browser-list">
          <template v-for="entry in entries" :key="entry.name">
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
              <button type="button" @click="renameEntry"><span class="mdi mdi-rename-box"></span> リネーム</button>
              <button type="button" @click="moveEntry"><span class="mdi mdi-file-move-outline"></span> 移動</button>
              <button type="button" class="file-browser-action-delete" @click="deleteEntry"><span class="mdi mdi-delete-outline"></span> 削除</button>
              <button type="button" @click="contextEntry = null"><span class="mdi mdi-close"></span></button>
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
import { emit } from "../app-bridge.js";
import { renderFileIcon } from "../utils/file-icon.js";
import { formatSize } from "../utils/format.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const props = defineProps({
  diffFile: { type: String, default: "" },
  diffMessage: { type: String, default: "" },
});

const currentPath = ref("");
const entries = ref([]);
const fileContent = ref(null);
const loading = ref(false);
const error = ref("");
const contextEntry = ref(null);
const diffHtml = ref("");
const isDropActive = ref(false);
let dragDepth = 0;

function resetDropState() {
  dragDepth = 0;
  isDropActive.value = false;
}

const pathSegments = computed(() => {
  if (!currentPath.value) return [];
  return currentPath.value.split("/").filter(Boolean);
});

const displayPathSegments = computed(() => {
  if (props.diffFile) return props.diffFile.split("/").filter(Boolean);
  return pathSegments.value;
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

watch(() => props.diffFile, (file) => {
  if (!file) { diffHtml.value = ""; return; }
  const chunk = gitStore.diffChunks[file];
  if (chunk) {
    diffHtml.value = `<pre>${colorDiff(chunk)}</pre>`;
  } else if (gitStore.diffFullText) {
    diffHtml.value = `<pre>${colorDiff(gitStore.diffFullText)}</pre>`;
  } else {
    diffHtml.value = "";
  }
}, { immediate: true });

watch(() => props.diffMessage, (msg) => {
  if (msg) {
    diffHtml.value = `<div style="color:var(--text-muted);padding:16px;text-align:center">${escapeDiffHtml(msg)}</div>`;
  }
}, { immediate: true });

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
let longPressEl = null;
let longPressTriggered = false;

function onLongPressStart(e, entry) {
  longPressTriggered = false;
  const el = e.currentTarget;
  longPressEl = el;
  el.classList.add("long-pressing");
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    el.classList.remove("long-pressing");
    el.classList.add("long-pressed");
    contextEntry.value = entry;
  }, 500);
}

function onLongPressEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (longPressEl) {
    longPressEl.classList.remove("long-pressing");
    if (!longPressTriggered) {
      longPressEl.classList.remove("long-pressed");
    }
    longPressEl = null;
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
      body: { src, dest },
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
      body: { path: filePath },
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

async function openEntryInEditor() {
  const filePath = entryPath();
  if (!filePath) return;
  contextEntry.value = null;
  try {
    const [settingsRes, infoRes] = await Promise.all([
      auth.apiFetch("/settings/editor"),
      auth.apiFetch("/system/info"),
    ]);
    const settings = settingsRes?.ok ? await settingsRes.json() : {};
    const info = infoRes?.ok ? await infoRes.json() : {};
    const tmpl = (settings.url_template || "").trim();
    if (!tmpl) {
      currentPath.value = filePath;
      openFile(filePath);
      return;
    }
    const workspace = workspaceStore.selectedWorkspace || "";
    const url = tmpl
      .replace(/\{user\}/g, info.user || "")
      .replace(/\{host\}/g, info.hostname || "")
      .replace(/\{work_dir\}/g, info.work_dir || "")
      .replace(/\{workspace\}/g, workspace)
      + "/" + filePath;
    window.open(url, "_blank");
  } catch {
    currentPath.value = filePath;
    openFile(filePath);
  }
}

function hasFileDrag(e) {
  const types = e?.dataTransfer?.types;
  return !!types && Array.from(types).includes("Files");
}

function onDragEnter(e) {
  if (props.diffFile || !hasFileDrag(e)) return;
  dragDepth += 1;
  isDropActive.value = true;
}

function onDragOver(e) {
  if (props.diffFile || !hasFileDrag(e)) return;
  e.preventDefault();
  isDropActive.value = true;
}

function onDragLeave(e) {
  if (props.diffFile || !hasFileDrag(e)) return;
  if (e.currentTarget?.contains(e.relatedTarget)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    isDropActive.value = false;
  }
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
  await navigate(uploadPath);
}

async function onDropFiles(e) {
  if (props.diffFile || !hasFileDrag(e)) return;
  e.preventDefault();
  resetDropState();
  const droppedFiles = Array.from(e?.dataTransfer?.files || []).filter((f) => f && f.name);
  if (droppedFiles.length === 0) return;
  await uploadDroppedFiles(droppedFiles);
}

function onWindowDrop() {
  resetDropState();
}

function onWindowDragLeave(e) {
  if (!isDropActive.value) return;
  // Pointer left the viewport while dragging.
  if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
    resetDropState();
  }
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
    navigate(currentPath.value);
    return;
  }
  navigate(path);
}

function onEntryClick(entry) {
  if (longPressEl || contextEntry.value || longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  const childPath = currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name;
  if (entry.type === "dir") {
    navigate(childPath);
  } else if (entry.type === "file") {
    currentPath.value = childPath;
    openFile(childPath);
  }
}

onMounted(() => {
  window.addEventListener("drop", onWindowDrop);
  window.addEventListener("dragleave", onWindowDragLeave);
});

onBeforeUnmount(() => {
  window.removeEventListener("drop", onWindowDrop);
  window.removeEventListener("dragleave", onWindowDragLeave);
});

defineExpose({ load });
</script>
