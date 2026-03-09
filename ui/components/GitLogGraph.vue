<template>
  <div class="git-graph-pane-wrapper">
    <div class="modal-scroll-body" ref="graphListEl" @scroll.passive="onGraphListScroll">
      <div v-if="isGraphLoading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <div v-else-if="graphRows.length === 0" style="color:var(--text-muted);padding:16px;text-align:center">コミットログがありません</div>
      <div v-else class="git-graph-list">
        <template v-for="(row, idx) in graphRows" :key="idx">
          <div
            class="git-graph-row"
            :class="{ 'git-graph-row-commit': row.entry, 'long-press-surface': !!row.entry, 'action-open': longPressEntry?.fullHash === row.entry?.fullHash }"
            @click="row.entry && onCommitRowClick(row.entry)"
            @mousedown="row.entry && onLongPressStart($event, row.entry)"
            @mouseup="onLongPressEnd"
            @mouseleave="onLongPressEnd"
            @touchstart.passive="row.entry && onLongPressStart($event, row.entry)"
            @touchend="onLongPressEnd"
            @touchcancel="onLongPressEnd"
            @contextmenu.prevent="row.entry && toggleActionMenu(row.entry)"
          >
            <svg class="git-graph-svg" :width="graphWidth" :height="ROW_HEIGHT" :viewBox="'0 0 ' + graphWidth + ' ' + ROW_HEIGHT">
              <template v-for="(seg, si) in row.segments" :key="si">
                <line v-if="seg.type === 'line'" :x1="seg.x" :y1="seg.y1" :x2="seg.x2 ?? seg.x" :y2="seg.y2" :stroke="seg.color" stroke-width="2" />
                <circle v-if="seg.type === 'node'" :cx="seg.x" :cy="seg.y" r="4" :fill="seg.color" />
              </template>
            </svg>
            <div v-if="row.entry" class="git-graph-info">
              <span class="git-graph-msg">{{ row.entry.message }}</span>
              <span class="git-graph-meta">
                <span v-if="row.entry.refs.length" class="git-log-entry-refs">
                  <span v-for="r in row.entry.refs" :key="r.label" class="git-ref" :class="'git-ref-' + r.type">
                    <span :class="'mdi ' + r.icon"></span>{{ r.label }}
                  </span>
                </span>
                <span class="git-graph-author">{{ row.entry.author }}</span>
                <span class="git-graph-time">{{ row.entry.time }}</span>
              </span>
            </div>
          </div>
          <div v-if="row.entry && longPressEntry?.fullHash === row.entry.fullHash" class="commit-action-menu">
            <button type="button" class="modal-action-btn" @click="execAction('cherry-pick', row.entry)">cherry-pick</button>
            <button type="button" class="modal-action-btn" @click="execAction('revert', row.entry)">revert</button>
            <button type="button" class="modal-action-btn" @click="execReset(row.entry, 'soft')">reset --soft</button>
            <button type="button" class="modal-action-btn commit-action-danger" @click="execReset(row.entry, 'hard')">reset --hard</button>
            <button type="button" class="modal-action-btn" @click="closeLongPressMenu">
              <span class="mdi mdi-close"></span>
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { formatGitTime, parseGitRefs } from "../utils/git.js";
import { INFINITE_SCROLL_THRESHOLD_PX } from "../utils/constants.js";
import { emit as bridgeEmit } from "../app-bridge.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const ROW_HEIGHT = 28;
const COL_WIDTH = 16;
const HALF = ROW_HEIGHT / 2;
const COLORS = ["#7aa2f7", "#9ece6a", "#f7768e", "#e0af68", "#bb9af7", "#7dcfff", "#ff9e64", "#c0caf5"];

const graphRows = ref([]);
const isGraphLoading = ref(false);
const hasMoreGraphHistory = ref(false);
const isLoadingMoreGraphHistory = ref(false);
const graphListEl = ref(null);
const longPressEntry = ref(null);
let longPressTimer = null;
let longPressEl = null;
let longPressTriggered = false;
let graphHistoryPage = 0;

const graphWidth = computed(() => {
  let maxCol = 0;
  for (const row of graphRows.value) {
    for (const seg of row.segments) {
      const col = seg.type === 'node' ? Math.round(seg.x / COL_WIDTH) : Math.max(Math.round(seg.x / COL_WIDTH), Math.round((seg.x2 ?? seg.x) / COL_WIDTH));
      if (col > maxCol) maxCol = col;
    }
  }
  return (maxCol + 2) * COL_WIDTH;
});

function colColor(col) {
  return COLORS[col % COLORS.length];
}

function parseGitGraphOutput(stdout) {
  if (!stdout) return [];
  const lines = stdout.split("\n");
  const parsed = [];

  for (const line of lines) {
    const match = line.match(/^([*|/\\ _\-.]+?)\s*([0-9a-f]{40}\t.+)$/);
    if (match) {
      const graphPart = match[1];
      const dataPart = match[2];
      const fields = dataPart.split("\t");
      if (fields.length >= 5) {
        const [hash, time, author, refs, ...msgParts] = fields;
        parsed.push({
          graph: graphPart,
          entry: {
            hash: hash.slice(0, 8),
            fullHash: hash,
            author,
            time: formatGitTime(time),
            message: msgParts.join("\t"),
            refs: parseGitRefs(refs),
          },
        });
      } else {
        parsed.push({ graph: graphPart, entry: null });
      }
    } else {
      parsed.push({ graph: line.replace(/\t.*$/, ""), entry: null });
    }
  }
  return parsed;
}

function buildGitGraphRows(parsed) {
  const result = [];
  const lanes = [];

  for (const item of parsed) {
    const graph = item.graph;
    const segments = [];
    let nodeCol = -1;

    for (let i = 0; i < graph.length; i++) {
      const ch = graph[i];
      const col = i;
      const x = col * COL_WIDTH + COL_WIDTH / 2;

      if (ch === "*") {
        nodeCol = col;
        segments.push({ type: "node", x, y: HALF, color: colColor(col) });
        segments.push({ type: "line", x, y1: 0, y2: HALF, color: colColor(col) });
        segments.push({ type: "line", x, y1: HALF, y2: ROW_HEIGHT, color: colColor(col) });
        if (!lanes.includes(col)) lanes.push(col);
      } else if (ch === "|") {
        segments.push({ type: "line", x, y1: 0, y2: ROW_HEIGHT, color: colColor(col) });
      } else if (ch === "/" && col > 0) {
        const fromX = col * COL_WIDTH + COL_WIDTH / 2;
        const toX = (col - 1) * COL_WIDTH + COL_WIDTH / 2;
        segments.push({ type: "line", x: fromX, y1: ROW_HEIGHT, x2: toX, y2: 0, color: colColor(col - 1) });
      } else if (ch === "\\" && col > 0) {
        const fromX = (col - 1) * COL_WIDTH + COL_WIDTH / 2;
        const toX = col * COL_WIDTH + COL_WIDTH / 2;
        segments.push({ type: "line", x: fromX, y1: 0, x2: toX, y2: ROW_HEIGHT, color: colColor(col) });
      }
    }

    result.push({ segments, entry: item.entry });
  }

  return result;
}

function onCommitRowClick(entry) {
  if (longPressEl || longPressEntry.value || longPressTriggered) {
    longPressTriggered = false;
    return;
  }
}

function toggleActionMenu(entry) {
  if (longPressEntry.value?.fullHash === entry.fullHash) {
    longPressEntry.value = null;
  } else {
    longPressEntry.value = entry;
  }
}

function onLongPressStart(e, entry) {
  longPressTriggered = false;
  const el = e.currentTarget;
  longPressEl = el;
  el.classList.add("long-pressing");
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    el.classList.remove("long-pressing");
    el.classList.add("long-pressed");
    longPressEntry.value = entry;
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

function closeLongPressMenu() {
  longPressEntry.value = null;
  onLongPressEnd();
}

async function execAction(action, entry) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const shortHash = entry.hash;
  if (!confirm(`${action} ${shortHash} を実行しますか？`)) return;
  closeLongPressMenu();
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/${action}`, {
      method: "POST",
      body: { commit_hash: entry.fullHash },
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      bridgeEmit("toast:show", { message: data?.detail || `${action}に失敗しました`, type: "error" });
      return;
    }
    bridgeEmit("toast:show", { message: `${action} ${shortHash} 完了`, type: "success" });
    bridgeEmit("git:refresh");
  } catch (e) {
    bridgeEmit("toast:show", { message: e.message, type: "error" });
  }
}

async function execReset(entry, mode) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const shortHash = entry.hash;
  const msg = mode === "hard"
    ? `reset --hard ${shortHash} を実行します。作業ツリーの変更はすべて失われます。実行しますか？`
    : `reset --soft ${shortHash} を実行しますか？`;
  if (!confirm(msg)) return;
  closeLongPressMenu();
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/reset`, {
      method: "POST",
      body: { commit_hash: entry.fullHash, mode },
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      bridgeEmit("toast:show", { message: data?.detail || `reset --${mode}に失敗しました`, type: "error" });
      return;
    }
    bridgeEmit("toast:show", { message: `reset --${mode} ${shortHash} 完了`, type: "success" });
    bridgeEmit("git:refresh");
  } catch (e) {
    bridgeEmit("toast:show", { message: e.message, type: "error" });
  }
}

async function loadGraphHistory() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) { isGraphLoading.value = false; return; }
  isGraphLoading.value = true;
  hasMoreGraphHistory.value = false;
  isLoadingMoreGraphHistory.value = false;
  graphHistoryPage = 0;
  try {
    const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
    const res = await auth.apiFetch(
      `/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=0&graph=true`
    );
    if (!res || !res.ok) { isGraphLoading.value = false; return; }
    const data = await res.json();
    const parsed = parseGitGraphOutput(data.stdout);
    graphRows.value = buildGitGraphRows(parsed);
    hasMoreGraphHistory.value = parsed.filter((p) => p.entry).length >= perPage;
  } catch (e) {
    console.error("git graph load failed:", e);
  } finally {
    isGraphLoading.value = false;
    nextTick(() => onGraphListScroll());
  }
}

async function loadMoreGraphHistory() {
  if (isGraphLoading.value || isLoadingMoreGraphHistory.value || !hasMoreGraphHistory.value) return;
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  isLoadingMoreGraphHistory.value = true;
  graphHistoryPage++;
  const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
  try {
    const res = await auth.apiFetch(
      `/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=${graphHistoryPage * perPage}&graph=true`
    );
    if (!res || !res.ok) return;
    const data = await res.json();
    const parsed = parseGitGraphOutput(data.stdout);
    const newRows = buildGitGraphRows(parsed);
    graphRows.value = [...graphRows.value, ...newRows];
    hasMoreGraphHistory.value = parsed.filter((p) => p.entry).length >= perPage;
  } catch (e) {
    console.error("git graph loadMore failed:", e);
  } finally {
    isLoadingMoreGraphHistory.value = false;
    nextTick(() => onGraphListScroll());
  }
}

function onGraphListScroll() {
  if (!hasMoreGraphHistory.value || isGraphLoading.value || isLoadingMoreGraphHistory.value) return;
  const el = graphListEl.value;
  if (!el) return;
  const threshold = INFINITE_SCROLL_THRESHOLD_PX;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
    loadMoreGraphHistory();
  }
}

defineExpose({
  load: loadGraphHistory,
  loadGraphHistory,
});
</script>

<style scoped>
.git-graph-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.git-graph-pane-wrapper > .modal-scroll-body {
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.git-log-entry-refs {
  display: flex;
  gap: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
}

.git-ref {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  user-select: none;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  line-height: 1;
}

.git-ref .mdi {
  font-size: 12px;
}

.git-ref-branch {
  background: var(--accent);
  color: var(--bg-primary);
}

.git-ref-head {
  background: var(--success);
  color: var(--bg-primary);
}

.git-ref-remote {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.git-ref-tag {
  background: var(--warning);
  color: var(--bg-primary);
}

.commit-action-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.commit-action-danger {
  color: var(--error);
  border-color: var(--error);
}

.git-graph-row.action-open {
  background: rgba(130, 170, 255, 0.08);
}

.git-graph-row {
  display: flex;
  align-items: center;
  min-height: 28px;
}

.git-graph-row-commit {
  cursor: pointer;
}

.git-graph-svg {
  flex-shrink: 0;
}

.git-graph-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 2px 8px 2px 0;
  overflow: hidden;
}

.git-graph-msg {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.git-graph-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  flex-wrap: wrap;
}

.git-graph-author,
.git-graph-time {
  white-space: nowrap;
}
</style>
