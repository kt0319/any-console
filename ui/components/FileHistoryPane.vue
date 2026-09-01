<template>
  <div class="file-history-pane pane-fill">
    <template v-if="!selectedEntry">
      <div v-if="isLoading" class="text-muted-center loading-dots">Loading</div>
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
            <span class="file-history-entry-hash">{{ shortHash(entry.hash) }}</span>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="file-history-diff-header">
        <button type="button" class="file-history-back-btn" aria-label="Back to file history" data-tooltip="Back" @click="clearSelection">
          <span class="mdi mdi-arrow-left"></span>
        </button>
        <div class="file-history-diff-summary">
          <div class="file-history-entry-msg">{{ selectedEntry.message }}</div>
          <div class="file-history-entry-meta">
            <span>{{ selectedEntry.author }}</span>
            <span>{{ selectedEntry.time }}</span>
            <span class="file-history-entry-hash">{{ shortHash(selectedEntry.hash) }}</span>
          </div>
        </div>
      </div>
      <div class="file-history-diff">
        <div v-if="isDiffLoading" class="text-muted-center loading-dots">Loading</div>
        <div v-else-if="diffError" class="text-muted-center">{{ diffError }}</div>
        <pre v-else class="file-history-diff-content" v-html="diffHtml"></pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { parseFileLog, shortHash, type FileLogEntry } from "../utils/git.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { workspaceFileHistoryPath, workspaceFileDiffPath } from "../utils/endpoints.ts";
import { colorDiff } from "../utils/diff-color.ts";
import { type AsyncState, asyncError, asyncIdle, asyncLoading, asyncReady, asyncValueOr, isAsyncPending } from "../utils/async-state.ts";

const props = defineProps({
  filePath: { type: String, required: true },
});

const workspaceStore = useWorkspaceStore();
const { apiGet } = useApi();

type HistoryEntry = FileLogEntry;

// 一覧取得（historyState）とdiff取得（diffState）は互いに独立した非同期状態
// （一覧を選び直してもdiff側のエラーは引きずらない、逆も同様）。
const historyState = ref<AsyncState<HistoryEntry[]>>(asyncIdle());
const entries = computed(() => asyncValueOr(historyState.value, [] as HistoryEntry[]));
const isLoading = computed(() => isAsyncPending(historyState.value));
const loadError = computed(() => (historyState.value.status === "error" ? historyState.value.error : ""));

const selectedEntry = ref<HistoryEntry | null>(null);
const diffState = ref<AsyncState<string>>(asyncIdle());
const diffHtml = computed(() => asyncValueOr(diffState.value, ""));
const isDiffLoading = computed(() => isAsyncPending(diffState.value));
const diffError = computed(() => (diffState.value.status === "error" ? diffState.value.error : ""));

async function loadHistory() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace || !props.filePath) return;
  selectedEntry.value = null;
  diffState.value = asyncIdle();
  historyState.value = asyncLoading();
  const { ok, data } = await getWithRetry(apiGet, workspaceFileHistoryPath(workspace, props.filePath));
  if (!ok) {
    historyState.value = asyncError(data?.stderr || data?.detail || "Failed to load history");
    return;
  }
  historyState.value = asyncReady(parseFileLog(data.stdout || ""));
}

async function selectEntry(entry: HistoryEntry) {
  selectedEntry.value = entry;
  diffState.value = asyncLoading();
  const workspace = workspaceStore.selectedWorkspace!;
  const { ok, data } = await getWithRetry(apiGet, workspaceFileDiffPath(workspace, entry.hash, props.filePath));
  if (!ok) {
    diffState.value = asyncError(data?.stderr || data?.detail || "Failed to load diff");
    return;
  }
  diffState.value = asyncReady(colorDiff(data.diff || ""));
}

function clearSelection() {
  selectedEntry.value = null;
  diffState.value = asyncIdle();
}

watch(() => props.filePath, loadHistory, { immediate: true });
</script>

<style scoped>

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
