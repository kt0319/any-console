<template>
  <div class="git-history-pane-wrapper">
    <div class="modal-scroll-body" ref="listEl">
      <div v-if="loading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <div v-else-if="entries.length === 0" style="color:var(--text-muted);padding:16px;text-align:center">コミットログがありません</div>
      <template v-for="entry in entries" :key="entry.hash">
        <div
          class="git-log-entry git-log-commit"
          :class="{ 'action-open': longPressEntry?.hash === entry.hash }"
          @click="selectCommit(entry)"
          @mousedown="onLongPressStart($event, entry)"
          @mouseup="onLongPressEnd"
          @mouseleave="onLongPressEnd"
          @touchstart.passive="onLongPressStart($event, entry)"
          @touchend="onLongPressEnd"
          @touchcancel="onLongPressEnd"
          @contextmenu.prevent="toggleActionMenu(entry)"
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
        <div v-if="longPressEntry?.hash === entry.hash" class="commit-action-menu">
          <button type="button" class="modal-action-btn" @click="execAction('cherry-pick', entry)">cherry-pick</button>
          <button type="button" class="modal-action-btn" @click="execAction('revert', entry)">revert</button>
          <button type="button" class="modal-action-btn" @click="execReset(entry, 'soft')">reset --soft</button>
          <button type="button" class="modal-action-btn commit-action-danger" @click="execReset(entry, 'hard')">reset --hard</button>
          <button type="button" class="modal-action-btn" @click="closeLongPressMenu">
            <span class="mdi mdi-close"></span>
          </button>
        </div>
      </template>
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
let longPressTriggered = false;
const longPressEntry = ref(null);

function toggleActionMenu(entry) {
  if (longPressEntry.value?.hash === entry.hash) {
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit_hash: entry.fullHash }),
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      emit("toast:show", { message: data?.detail || `${action}に失敗しました`, type: "error" });
      return;
    }
    emit("toast:show", { message: `${action} ${shortHash} 完了`, type: "success" });
    emit("git:refresh");
  } catch (e) {
    emit("toast:show", { message: e.message, type: "error" });
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commit_hash: entry.fullHash, mode }),
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      emit("toast:show", { message: data?.detail || `reset --${mode}に失敗しました`, type: "error" });
      return;
    }
    emit("toast:show", { message: `reset --${mode} ${shortHash} 完了`, type: "success" });
    emit("git:refresh");
  } catch (e) {
    emit("toast:show", { message: e.message, type: "error" });
  }
}

function selectCommit(entry) {
  if (longPressEl || longPressEntry.value || longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  emit("git:selectCommit", { hash: entry.fullHash, message: entry.message, refs: entry.refs });
}

async function reload() {
  await load();
}

onMounted(load);

defineExpose({ reload, load });
</script>
