<template>
  <div class="file-history-pane">
    <template v-if="!selectedEntry">
      <div v-if="isLoading" class="text-muted-center">Loading...</div>
      <div v-else-if="loadError" class="text-muted-center">{{ loadError }}</div>
      <div v-else-if="entries.length === 0" class="text-muted-center">No history</div>
      <div v-else class="file-history-list">
        <div
          v-for="entry in entries"
          :key="entry.hash"
          class="file-history-entry"
          @click="selectEntry(entry)"
        >
          <div class="file-history-entry-msg">{{ entry.message }}</div>
          <div class="file-history-entry-meta">
            <span class="file-history-entry-author">{{ entry.author }}</span>
            <span class="file-history-entry-time">{{ entry.time }}</span>
            <span class="file-history-entry-hash">{{ entry.hash.slice(0, 7) }}</span>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="file-history-diff-header">
        <button type="button" class="file-history-back-btn" @click="clearSelection">
          <span class="mdi mdi-arrow-left"></span>
        </button>
        <div class="file-history-diff-summary">
          <div class="file-history-entry-msg">{{ selectedEntry.message }}</div>
          <div class="file-history-entry-meta">
            <span>{{ selectedEntry.author }}</span>
            <span>{{ selectedEntry.time }}</span>
            <span class="file-history-entry-hash">{{ selectedEntry.hash.slice(0, 7) }}</span>
          </div>
        </div>
      </div>
      <div class="file-history-diff">
        <div v-if="isDiffLoading" class="text-muted-center">Loading...</div>
        <div v-else-if="diffError" class="text-muted-center">{{ diffError }}</div>
        <pre v-else class="file-history-diff-content" v-html="diffHtml"></pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { workspaceFileHistoryPath, workspaceFileDiffPath } from "../utils/endpoints.ts";
import { colorDiff } from "../utils/diff-color.ts";

const props = defineProps({
  filePath: { type: String, required: true },
});

const workspaceStore = useWorkspaceStore();
const { apiGet } = useApi();

// git log 1行分（parseLogOutput が組み立てる表示用エントリ）。
type HistoryEntry = { hash: string, time: string, author: string, message: string };

const entries = ref<HistoryEntry[]>([]);
const isLoading = ref(false);
const loadError = ref("");
const selectedEntry = ref<HistoryEntry | null>(null);
const diffHtml = ref("");
const isDiffLoading = ref(false);
const diffError = ref("");

function parseLogOutput(stdout: string): HistoryEntry[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const [hash = "", time = "", author = "", ...messageParts] = parts;
      return {
        hash,
        time,
        author,
        message: messageParts.join("\t"),
      };
    })
    .filter((e) => e.hash);
}

async function loadHistory() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace || !props.filePath) return;
  entries.value = [];
  selectedEntry.value = null;
  diffHtml.value = "";
  isLoading.value = true;
  loadError.value = "";
  try {
    const { ok, data } = await getWithRetry(apiGet, workspaceFileHistoryPath(workspace, props.filePath));
    if (!ok) {
      loadError.value = data?.stderr || data?.detail || "Failed to load history";
      return;
    }
    entries.value = parseLogOutput(data.stdout || "");
  } finally {
    isLoading.value = false;
  }
}

async function selectEntry(entry: HistoryEntry) {
  selectedEntry.value = entry;
  diffHtml.value = "";
  diffError.value = "";
  isDiffLoading.value = true;
  try {
    const workspace = workspaceStore.selectedWorkspace!;
    const { ok, data } = await getWithRetry(apiGet, workspaceFileDiffPath(workspace, entry.hash, props.filePath));
    if (!ok) {
      diffError.value = data?.stderr || data?.detail || "Failed to load diff";
      return;
    }
    diffHtml.value = colorDiff(data.diff || "");
  } finally {
    isDiffLoading.value = false;
  }
}

function clearSelection() {
  selectedEntry.value = null;
  diffHtml.value = "";
  diffError.value = "";
}

watch(() => props.filePath, loadHistory, { immediate: true });
</script>

<style scoped>
.file-history-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.file-history-list {
  flex: 1;
  overflow-y: auto;
}

.file-history-entry {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-history-entry:last-child {
  border-bottom: none;
}

.file-history-entry-msg {
  color: var(--text-primary);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-history-entry-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.file-history-entry-hash {
  font-family: monospace;
}

.file-history-diff-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.file-history-back-btn {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 18px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  min-width: 32px;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (hover: hover) and (pointer: fine) {
  .file-history-back-btn:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }
}

.file-history-diff-summary {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-history-diff {
  flex: 1 1 0;
  overflow: auto;
  min-height: 0;
}

.file-history-diff-content {
  margin: 0;
  padding: 8px 10px;
  font-family: monospace;
  font-size: 12px;
  white-space: pre;
  color: var(--text-primary);
}
</style>
