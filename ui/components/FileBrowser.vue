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
        <li
          v-for="entry in entries"
          :key="entry.name"
          class="file-browser-item"
          :data-type="entry.type"
          @click="onEntryClick(entry)"
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
      </ul>
      <div v-if="entries.length === 0" class="file-content-message">ファイルがありません</div>
    </template>

    <template v-else>
      <div v-if="fileContent.image && fileContent.data_url" class="file-content-image-wrap">
        <img :src="fileContent.data_url" class="file-content-image" />
      </div>
      <div v-else-if="fileContent.binary" class="file-content-message">バイナリファイル ({{ formatSize(fileContent.size) }})</div>
      <div v-else-if="fileContent.too_large" class="file-content-message">ファイルが大きすぎます ({{ formatSize(fileContent.size) }})</div>
      <pre v-else class="file-content-viewer">{{ fileContent.content }}</pre>
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();

const currentPath = ref("");
const entries = ref([]);
const fileContent = ref(null);
const loading = ref(false);
const error = ref("");

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

function onEntryClick(entry) {
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
