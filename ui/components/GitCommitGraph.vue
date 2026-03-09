<template>
  <div class="git-graph-pane-wrapper">
    <div class="modal-scroll-body" ref="scrollEl">
      <div v-if="loading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <div v-else-if="rows.length === 0" style="color:var(--text-muted);padding:16px;text-align:center">コミットログがありません</div>
      <div v-else class="git-graph-list">
        <div
          v-for="(row, idx) in rows"
          :key="idx"
          class="git-graph-row"
          :class="{ 'git-graph-row-commit': row.entry }"
          @click="row.entry && selectCommit(row.entry)"
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
        <div v-if="hasMore" class="git-log-load-more" @click="loadMore">さらに読み込む</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const ROW_HEIGHT = 28;
const COL_WIDTH = 16;
const HALF = ROW_HEIGHT / 2;
const COLORS = ["#7aa2f7", "#9ece6a", "#f7768e", "#e0af68", "#bb9af7", "#7dcfff", "#ff9e64", "#c0caf5"];

const rows = ref([]);
const loading = ref(false);
const hasMore = ref(false);
const scrollEl = ref(null);
let page = 0;

const graphWidth = computed(() => {
  let maxCol = 0;
  for (const row of rows.value) {
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

function parseGraphOutput(stdout) {
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
            time: formatTime(time),
            message: msgParts.join("\t"),
            refs: parseRefs(refs),
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

function buildGraphRows(parsed) {
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

function parseRefs(refsStr) {
  if (!refsStr) return [];
  return refsStr.split(", ")
    .filter((r) => r !== "HEAD" && r !== "origin/HEAD")
    .map((r) => {
      if (r.startsWith("HEAD -> ")) return { label: r.replace("HEAD -> ", ""), type: "head", icon: "mdi-source-branch" };
      if (r.startsWith("tag: ")) return { label: r.replace("tag: ", ""), type: "tag", icon: "mdi-tag-outline" };
      if (r.startsWith("origin/")) return { label: r, type: "remote", icon: "mdi-github" };
      if (r.startsWith("upstream/")) return { label: r, type: "remote", icon: "mdi-server" };
      return { label: r, type: "branch", icon: "mdi-source-branch" };
    });
}

function formatTime(timeText) {
  if (!timeText) return "-";
  const d = new Date(timeText);
  if (Number.isNaN(d.getTime())) return timeText;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function selectCommit(entry) {
  // TODO: コミット詳細表示
}

async function load() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) { loading.value = false; return; }
  loading.value = true;
  page = 0;
  try {
    const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
    const res = await auth.apiFetch(
      `/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=0&graph=true`
    );
    if (!res || !res.ok) { loading.value = false; return; }
    const data = await res.json();
    const parsed = parseGraphOutput(data.stdout);
    rows.value = buildGraphRows(parsed);
    hasMore.value = parsed.filter((p) => p.entry).length >= perPage;
  } catch (e) {
    console.error("git graph load failed:", e);
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  page++;
  const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
  try {
    const res = await auth.apiFetch(
      `/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=${page * perPage}&graph=true`
    );
    if (!res || !res.ok) return;
    const data = await res.json();
    const parsed = parseGraphOutput(data.stdout);
    const newRows = buildGraphRows(parsed);
    rows.value = [...rows.value, ...newRows];
    hasMore.value = parsed.filter((p) => p.entry).length >= perPage;
  } catch (e) {
    console.error("git graph loadMore failed:", e);
  }
}

defineExpose({ load });
</script>
