<template>
  <div class="git-graph-pane-wrapper">
    <div class="modal-scroll-body" ref="graphListEl" @scroll.passive="onGraphListScroll">
      <div v-if="isGraphLoading" class="text-muted-center">読み込み中...</div>
      <div v-else-if="graphRows.length === 0" class="text-muted-center">コミットログがありません</div>
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
                    <span v-if="r.synced" class="mdi mdi-link-variant"></span><span :class="'mdi ' + r.icon"></span>{{ r.label }}
                  </span>
                </span>
                <span class="git-graph-right"><span class="git-graph-author">{{ row.entry.author }}</span> <span class="git-graph-time">{{ row.entry.time }}</span></span>
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
import { ref, computed, nextTick, onMounted, inject } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { useApi } from "../composables/useApi.js";
import { formatGitTime, parseGitRefs } from "../utils/git.js";
import { INFINITE_SCROLL_THRESHOLD_PX } from "../utils/constants.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useGitCommitAction } from "../composables/useGitCommitAction.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "コミットグラフ";

const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();
const { apiGet, wsEndpoint } = useApi();
const { execAction: execCommitAction, execReset: execCommitReset } = useGitCommitAction();

const ROW_HEIGHT = 28;
const COL_WIDTH = 12;
const HALF = ROW_HEIGHT / 2;
const COLORS = ["#7aa2f7", "#9ece6a", "#f7768e", "#e0af68", "#bb9af7", "#7dcfff", "#ff9e64", "#c0caf5"];

const graphRows = ref([]);
const isGraphLoading = ref(false);
const hasMoreGraphHistory = ref(false);
const isLoadingMoreGraphHistory = ref(false);
const graphListEl = ref(null);
const { activeEntry: longPressEntry, startMenu: onLongPressStart, endMenu: onLongPressEnd, closeMenu: closeLongPressMenu, isFired: isLongPressFired, isMenuEl } = useLongPress();
let graphHistoryPage = 0;

const graphWidth = computed(() => {
  let maxCol = 0;
  for (const row of graphRows.value) {
    for (const seg of row.segments) {
      const col = seg.type === 'node' ? Math.round(seg.x / COL_WIDTH) : Math.max(Math.round(seg.x / COL_WIDTH), Math.round((seg.x2 ?? seg.x) / COL_WIDTH));
      if (col > maxCol) maxCol = col;
    }
  }
  return (maxCol + 1) * COL_WIDTH;
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

  for (const item of parsed) {
    const graph = item.graph;
    const segments = [];

    for (let i = 0; i < graph.length; i++) {
      const ch = graph[i];

      if (ch === "*" || ch === "|") {
        const col = Math.floor(i / 2);
        const x = col * COL_WIDTH + COL_WIDTH / 2;
        if (ch === "*") {
          segments.push({ type: "node", x, y: HALF, color: colColor(col) });
          segments.push({ type: "line", x, y1: 0, y2: HALF, color: colColor(col) });
          segments.push({ type: "line", x, y1: HALF, y2: ROW_HEIGHT, color: colColor(col) });
        } else {
          segments.push({ type: "line", x, y1: 0, y2: ROW_HEIGHT, color: colColor(col) });
        }
      } else if (ch === "/") {
        const fromCol = Math.ceil(i / 2);
        const toCol = Math.floor(i / 2);
        const fromX = fromCol * COL_WIDTH + COL_WIDTH / 2;
        const toX = toCol * COL_WIDTH + COL_WIDTH / 2;
        segments.push({ type: "line", x: fromX, y1: 0, x2: toX, y2: ROW_HEIGHT, color: colColor(fromCol) });
      } else if (ch === "\\") {
        const fromCol = Math.floor(i / 2);
        const toCol = Math.ceil(i / 2);
        const fromX = fromCol * COL_WIDTH + COL_WIDTH / 2;
        const toX = toCol * COL_WIDTH + COL_WIDTH / 2;
        segments.push({ type: "line", x: fromX, y1: 0, x2: toX, y2: ROW_HEIGHT, color: colColor(toCol) });
      }
    }

    result.push({ segments, entry: item.entry });
  }

  return result;
}

function onCommitRowClick(entry) {
  if (isMenuEl() || longPressEntry.value || isLongPressFired()) {
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

function execAction(action, entry) {
  execCommitAction(action, entry, closeLongPressMenu);
}

function execReset(entry, mode) {
  execCommitReset(entry, mode, closeLongPressMenu);
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
    const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${perPage}&skip=0&graph=true`));
    if (!ok) { isGraphLoading.value = false; return; }
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
  const totalLimit = (graphHistoryPage + 1) * perPage;
  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${totalLimit}&skip=0&graph=true`));
    if (!ok) return;
    const parsed = parseGitGraphOutput(data.stdout);
    graphRows.value = buildGitGraphRows(parsed);
    hasMoreGraphHistory.value = parsed.filter((p) => p.entry).length >= totalLimit;
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

onMounted(() => {
  loadGraphHistory();
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

.git-graph-right {
  margin-left: auto;
}

.git-graph-author,
.git-graph-time {
  white-space: nowrap;
}
</style>
