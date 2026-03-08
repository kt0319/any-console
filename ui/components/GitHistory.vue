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
        @touchstart.passive="onLongPressStart($event, entry)"
        @touchend="onLongPressEnd"
        @touchcancel="onLongPressEnd"
      >
        <span class="git-log-entry-body">
          <span class="git-log-entry-msg">{{ entry.message }}</span>
          <span class="git-log-entry-row1">
            <span class="git-log-entry-row1-left">
              <span v-if="entry.refs.length" class="git-log-entry-refs">
                <span v-for="r in entry.refs" :key="r.label" class="git-ref" :class="'git-ref-' + r.type"><span :class="'mdi ' + r.icon"></span>{{ r.label }}</span>
              </span>
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

function parseRefs(refsStr) {
  if (!refsStr) return [];
  return refsStr.split(", ")
    .filter((r) => r !== "HEAD" && r !== "origin/HEAD")
    .map((r) => {
      if (r.startsWith("HEAD -> ")) {
        return { label: r.replace("HEAD -> ", ""), type: "head", icon: "mdi-source-branch" };
      }
      if (r.startsWith("tag: ")) {
        return { label: r.replace("tag: ", ""), type: "tag", icon: "mdi-tag-outline" };
      }
      if (r.startsWith("origin/")) {
        return { label: r, type: "remote", icon: "mdi-github" };
      }
      if (r.startsWith("upstream/")) {
        return { label: r, type: "remote", icon: "mdi-server" };
      }
      return { label: r, type: "branch", icon: "mdi-source-branch" };
    });
}

function parseLogEntries(stdout) {
  if (!stdout) return [];
  const lines = stdout.trim().split("\n");
  const result = [];
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const [hash, time, author, refs, ...msgParts] = parts;
    const message = msgParts.join("\t");
    const refList = refs ? parseRefs(refs) : [];
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
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=0`);
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
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=${page * perPage}`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const newEntries = parseLogEntries(data.stdout);
    entries.value = [...entries.value, ...newEntries];
    hasMore.value = newEntries.length >= perPage;
  } catch (e) {
    console.error("git log loadMore failed:", e);
  }
}

let longPressTimer = null;
let longPressEl = null;

function onLongPressStart(e, entry) {
  const el = e.currentTarget;
  longPressEl = el;
  el.classList.add("long-pressing");
  longPressTimer = setTimeout(() => {
    el.classList.remove("long-pressing");
    el.classList.add("long-pressed");
    emit("git:commitLongPress", { hash: entry.fullHash, message: entry.message, el });
  }, 500);
}

function onLongPressEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (longPressEl) {
    longPressEl.classList.remove("long-pressing", "long-pressed");
    longPressEl = null;
  }
}

function selectCommit(entry) {
  if (longPressEl) return;
  emit("git:selectCommit", { hash: entry.fullHash, message: entry.message, refs: entry.refs });
}

async function reload() {
  await load();
}

onMounted(load);

defineExpose({ reload, load });
</script>
