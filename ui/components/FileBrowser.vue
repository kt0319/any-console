<template>
  <div class="file-browser">
    <div class="file-browser-header">
      <button class="file-browser-crumb" @click="navigate('')">{{ workspaceStore.selectedWorkspace || 'root' }}</button>
      <template v-for="(seg, i) in displayPathSegments" :key="i">
        <span class="file-browser-crumb-sep">/</span>
        <button
          v-if="i < displayPathSegments.length - 1"
          class="file-browser-crumb"
          @click="navigate(displayPathSegments.slice(0, i + 1).join('/'))"
        >{{ seg }}</button>
        <span v-else class="file-browser-crumb-current">{{ seg }}</span>
      </template>
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
            <li
              class="file-browser-item"
              :class="{ 'action-open': contextEntry?.name === entry.name, 'gitignored': entry.gitignored }"
              :data-type="entry.type"
              @click="onEntryClick(entry)"
              @contextmenu.prevent="toggleContextMenu(entry)"
              @touchstart.passive="onLongPressStart($event, entry)"
              @touchend="onLongPressEnd"
              @touchcancel="onLongPressEnd"
            >
              <span class="file-browser-item-icon nf-icon" v-html="entryIcon(entry)"></span>
              <span class="file-browser-item-name">{{ entry.name }}</span>
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

      <FileTextViewer v-else :fileContent="fileContent" :fileName="currentPath" />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import FileTextViewer from "./FileTextViewer.vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { emit } from "../app-bridge.js";

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

const NF_EXT_MAP = {
  js: ["\uE781", "#f1e05a"],
  mjs: ["\uE781", "#f1e05a"],
  ts: ["\uE628", "#3178c6"],
  tsx: ["\uE7ba", "#3178c6"],
  jsx: ["\uE7ba", "#61dafb"],
  vue: ["\uDB82\uDE20", "#42b883"],
  json: ["\uE60b", "#cbcb41"],
  html: ["\uE736", "#e44d26"],
  css: ["\uE749", "#563d7c"],
  scss: ["\uE749", "#c6538c"],
  py: ["\uE73C", "#3572a5"],
  rb: ["\uE739", "#cc342d"],
  rs: ["\uE7a8", "#dea584"],
  go: ["\uE627", "#00add8"],
  java: ["\uE738", "#b07219"],
  c: ["\uE61E", "#555555"],
  cpp: ["\uE61D", "#f34b7d"],
  h: ["\uE61E", "#555555"],
  sh: ["\uE795", "#89e051"],
  bash: ["\uE795", "#89e051"],
  zsh: ["\uE795", "#89e051"],
  md: ["\uE73E", "#083fa1"],
  yml: ["\uE6A8", "#cb171e"],
  yaml: ["\uE6A8", "#cb171e"],
  toml: ["\uE6b2", "#9c4221"],
  xml: ["\uE619", "#e44d26"],
  svg: ["\uDB80\uDDA5", "#ffb13b"],
  png: ["\uDB80\uDDA5", "#a074c4"],
  jpg: ["\uDB80\uDDA5", "#a074c4"],
  jpeg: ["\uDB80\uDDA5", "#a074c4"],
  gif: ["\uDB80\uDDA5", "#a074c4"],
  webp: ["\uDB80\uDDA5", "#a074c4"],
  ico: ["\uDB80\uDDA5", "#a074c4"],
  pdf: ["\uEAEB", "#e44d26"],
  zip: ["\uF410", "#e8a835"],
  gz: ["\uF410", "#e8a835"],
  tar: ["\uF410", "#e8a835"],
  lock: ["\uE21A", "#555555"],
  env: ["\uE615", "#faf743"],
  sql: ["\uE706", "#e38c00"],
  docker: ["\uE7b0", "#2496ed"],
  dockerfile: ["\uE7b0", "#2496ed"],
  gitignore: ["\uE702", "#f54d27"],
  txt: ["\uF0219", "#89e051"],
  log: ["\uF0219", "#555555"],
  conf: ["\uE615", "#6d8086"],
  cfg: ["\uE615", "#6d8086"],
  ini: ["\uE615", "#6d8086"],
  csv: ["\uF0219", "#89e051"],
  woff: ["\uE659", "#aaaaaa"],
  woff2: ["\uE659", "#aaaaaa"],
  ttf: ["\uE659", "#aaaaaa"],
  eot: ["\uE659", "#aaaaaa"],
};

const NF_NAME_MAP = {
  Dockerfile: ["\uE7b0", "#2496ed"],
  Makefile: ["\uE615", "#6d8086"],
  LICENSE: ["\uF0219", "#d4aa00"],
  README: ["\uE73E", "#083fa1"],
  "README.md": ["\uE73E", "#083fa1"],
  ".gitignore": ["\uE702", "#f54d27"],
  ".env": ["\uE615", "#faf743"],
  ".env.local": ["\uE615", "#faf743"],
};

function entryIcon(entry) {
  if (entry.type === "dir") {
    return `<span style="color:#e8a735">\uF0751</span>`;
  }
  if (entry.type === "symlink") {
    return `<span style="color:#7aa2f7">\uEB15</span>`;
  }
  const nameMatch = NF_NAME_MAP[entry.name];
  if (nameMatch) {
    return `<span style="color:${nameMatch[1]}">${nameMatch[0]}</span>`;
  }
  const ext = entry.name.includes(".") ? entry.name.split(".").pop().toLowerCase() : "";
  const extMatch = NF_EXT_MAP[ext];
  if (extMatch) {
    return `<span style="color:${extMatch[1]}">${extMatch[0]}</span>`;
  }
  return `<span style="color:#6d8086">\uF0219</span>`;
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
