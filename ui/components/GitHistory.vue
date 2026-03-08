<template>
  <div class="git-history-pane-wrapper">
    <div class="modal-scroll-body" ref="listEl">
      <div v-if="loading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <div v-else-if="entries.length === 0" style="color:var(--text-muted);padding:16px;text-align:center">コミットログがありません</div>
      <div
        v-for="entry in entries"
        :key="entry.hash"
        class="git-log-entry git-log-commit"
        @click="selectCommit(entry)"
      >
        <span class="git-log-entry-body">
          <span class="git-log-entry-msg">{{ entry.message }}</span>
          <span class="git-log-entry-row1">
            <span v-if="entry.refs.length" class="git-log-entry-refs">
              <span v-for="r in entry.refs" :key="r" class="git-ref">{{ r }}</span>
            </span>
            <span class="git-log-entry-meta">
              <span class="git-log-entry-author">{{ entry.author }}</span>
              <span class="git-log-entry-time">{{ entry.time }}</span>
            </span>
          </span>
        </span>
      </div>
      <div v-if="hasMore" class="git-log-load-more" @click="loadMore">さらに読み込む</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { emit } from "../app-bridge.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const entries = ref([]);
const loading = ref(true);
const hasMore = ref(false);
const listEl = ref(null);
let page = 0;

function parseLogEntries(stdout) {
  if (!stdout) return [];
  const lines = stdout.trim().split("\n");
  const result = [];
  for (const line of lines) {
    const parts = line.split("\x00");
    if (parts.length < 5) continue;
    const [hash, refs, author, time, ...msgParts] = parts;
    const message = msgParts.join("\x00");
    const refList = refs ? refs.split(", ").map((r) => r.replace(/^HEAD -> /, "").replace(/^tag: /, "")).filter(Boolean) : [];
    result.push({ hash: hash.slice(0, 8), fullHash: hash, refs: refList, author, time: formatTime(time), message });
  }
  return result;
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

async function load() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) { loading.value = false; return; }
  loading.value = true;
  page = 0;
  try {
    const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/log?limit=${perPage}&offset=0`);
    if (!res || !res.ok) { loading.value = false; return; }
    const data = await res.json();
    entries.value = parseLogEntries(data.stdout);
    hasMore.value = entries.value.length >= perPage;
  } catch (e) {
    console.error("git log load failed:", e);
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
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/log?limit=${perPage}&offset=${page * perPage}`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const newEntries = parseLogEntries(data.stdout);
    entries.value = [...entries.value, ...newEntries];
    hasMore.value = newEntries.length >= perPage;
  } catch (e) {
    console.error("git log loadMore failed:", e);
  }
}

function selectCommit(entry) {
  emit("git:selectCommit", { hash: entry.fullHash, message: entry.message, refs: entry.refs });
}

async function reload() {
  await load();
}

onMounted(load);

defineExpose({ reload, load });
</script>
