<template>
  <div class="git-history-pane-wrapper">
    <!-- ファイル一覧モード -->
    <template v-if="expandedEntry">
      <div class="modal-scroll-body">
        <div v-if="expandedLoading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
        <ul v-else class="file-browser-list diff-file-browser-list">
          <FileItem
            v-for="file in expandedFiles"
            :key="file.path"
            class="diff-file-row"
            :label="file.path"
            :icon-html="fileIconHtml(file)"
            @click="selectExpandedFile(file)"
          >
            <template #right>
              <span v-if="file.numstat" class="diff-file-row-numstat" v-html="file.numstat"></span>
              <span :class="['diff-file-row-status', statusClass(file.status)]">{{ file.status }}</span>
            </template>
          </FileItem>
        </ul>
      </div>
    </template>
    <!-- コミット履歴モード -->
    <div v-else class="modal-scroll-body" ref="listEl" @scroll.passive="onListScroll">
      <div v-if="loading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <div v-else-if="entries.length === 0" style="color:var(--text-muted);padding:16px;text-align:center">コミットログがありません</div>
      <!-- 未コミットの変更 / 変更なし -->
      <div v-if="!loading && entries.length > 0" class="git-log-entry git-log-dirty" @click="selectDirty">
        <span class="git-log-entry-body git-log-dirty-body">
          <span class="git-log-dirty-main">
            <span class="git-log-entry-msg git-log-dirty-msg">{{ isDirty ? '未コミットの変更' : '変更なし' }}</span>
            <span class="git-log-entry-refs" :class="{ 'git-dirty-spacer': !isDirty }">
              <span class="git-ref git-ref-dirty" v-html="dirtyStat"></span>
            </span>
          </span>
        </span>
        <div class="git-log-dirty-actions" @click.stop>
          <button type="button" class="git-action-btn icon-only" title="ブランチ" @click="selectPane('branch')">
            <span class="mdi mdi-source-branch"></span>
          </button>
          <button type="button" class="git-action-btn icon-only" title="Stash" @click="selectPane('stash')">
            <span class="mdi mdi-package-down"></span>
          </button>
          <button type="button" class="git-action-btn icon-only" title="コミットグラフ" @click="selectPane('graph')">
            <span class="mdi mdi-source-branch-sync"></span>
          </button>
          <button v-if="githubUrl" type="button" class="git-action-btn icon-only" title="GitHub" @click="selectPane('github')">
            <span class="mdi mdi-github"></span>
          </button>
        </div>
      </div>
      <template v-for="entry in entries" :key="entry.hash">
        <div
          class="git-log-entry git-log-commit long-press-surface"
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
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from "vue";
import FileItem from "./FileItem.vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore, parseDiffChunks } from "../stores/git.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { renderFileIconFromPath } from "../utils/file-icon.js";
import {
  buildNumstatHtml,
  parseDiffNumstatFromChunk,
  parseGitLogEntries,
  resolveUntrackedNumstat,
} from "../utils/git.js";
import { GIT_DIFF_STATUS_CLASSES, INFINITE_SCROLL_THRESHOLD_PX } from "../utils/constants.js";

const vueEmit = defineEmits(["pane:select", "commit:expanded", "commit:collapsed"]);

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const activePane = ref("browser");

function selectPane(key) {
  activePane.value = key;
  vueEmit("pane:select", key);
}

const currentWs = computed(() =>
  workspaceStore.allWorkspaces.find((w) => w.name === workspaceStore.selectedWorkspace),
);
const isDirty = computed(() => currentWs.value && currentWs.value.clean === false);
const githubUrl = computed(() => currentWs.value?.github_url || "");
const dirtyStat = computed(() => {
  const ws = currentWs.value;
  if (!ws || ws.clean !== false) return "0F +0 -0";
  const parts = [];
  if (ws.changed_files > 0) parts.push(`<span class="stat-files">${ws.changed_files}F</span>`);
  if (ws.insertions > 0) parts.push(`<span class="stat-add">+${ws.insertions}</span>`);
  if (ws.deletions > 0) parts.push(`<span class="stat-del">-${ws.deletions}</span>`);
  return parts.length > 0 ? parts.join(" ") : "\u25cf";
});

const entries = ref([]);
const loading = ref(true);
const hasMore = ref(false);
const loadingMore = ref(false);
const listEl = ref(null);
let page = 0;

const expandedEntry = ref(null);
const expandedFiles = ref([]);
const expandedLoading = ref(false);

function statusClass(status) {
  return GIT_DIFF_STATUS_CLASSES[status] || "";
}

function fileIconHtml(file) {
  return renderFileIconFromPath(file.path);
}

function buildFileNumstatHtml(file, diffChunk = "", opts = {}) {
  const status = String(file.status || "").trim();
  const omitZeroDeletions = status === "??" || status === "A";
  const { neutralText = false } = opts;
  if (file.insertions != null || file.deletions != null) {
    return buildNumstatHtml(file.insertions, file.deletions, { omitZeroDeletions, neutralText });
  }
  const parsed = parseDiffNumstatFromChunk(diffChunk);
  return buildNumstatHtml(parsed?.insertions, parsed?.deletions, { omitZeroDeletions, neutralText });
}

async function load() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) { loading.value = false; return; }
  loading.value = true;
  hasMore.value = false;
  loadingMore.value = false;
  page = 0;
  try {
    const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=0`);
    if (!res || !res.ok) { loading.value = false; return; }
    const data = await res.json();
    entries.value = parseGitLogEntries(data.stdout);
    hasMore.value = entries.value.length >= perPage;
  } catch (e) {
    console.error("git log load failed:", e);
  } finally {
    loading.value = false;
    nextTick(() => onListScroll());
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  loadingMore.value = true;
  page++;
  const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=${page * perPage}`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const newEntries = parseGitLogEntries(data.stdout);
    entries.value = [...entries.value, ...newEntries];
    hasMore.value = newEntries.length >= perPage;
  } catch (e) {
    console.error("git log loadMore failed:", e);
  } finally {
    loadingMore.value = false;
    nextTick(() => onListScroll());
  }
}

function onListScroll() {
  if (!hasMore.value || loading.value || loadingMore.value) return;
  const el = listEl.value;
  if (!el) return;
  const threshold = INFINITE_SCROLL_THRESHOLD_PX;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
    loadMore();
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

async function selectDirty() {
  if (!isDirty.value) return;
  expandedEntry.value = { message: "未コミットの変更", author: "", time: "", hash: "__dirty__", fullHash: "__dirty__" };
  vueEmit("commit:expanded", { message: expandedEntry.value.message });
  expandedFiles.value = [];
  expandedLoading.value = true;
  try {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/diff`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const fileList = (data.files || []).map((f) => ({
      path: f.path || f.name,
      status: f.status || "M",
      insertions: f.insertions,
      deletions: f.deletions,
    }));
    const untrackedNumstat = await resolveUntrackedNumstat({
      workspace,
      files: fileList,
      apiFetch: auth.apiFetch.bind(auth),
    });
    const diffChunks = parseDiffChunks(data.diff);
    gitStore.diffChunks = diffChunks;
    gitStore.diffFullText = data.diff || "";
    expandedFiles.value = fileList.map((f) => ({
      path: f.path,
      status: f.status,
      numstat: buildFileNumstatHtml(
        { ...f, insertions: f.insertions ?? untrackedNumstat[f.path], deletions: f.deletions ?? (untrackedNumstat[f.path] != null ? 0 : f.deletions) },
        diffChunks[f.path],
        { neutralText: untrackedNumstat[f.path] != null && f.insertions == null && f.deletions == null },
      ),
    }));
  } catch (e) {
    console.error("dirty files load failed:", e);
  } finally {
    expandedLoading.value = false;
  }
}

async function selectCommit(entry) {
  if (longPressEl || longPressEntry.value || longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  expandedEntry.value = entry;
  vueEmit("commit:expanded", { message: entry.message });
  expandedFiles.value = [];
  expandedLoading.value = true;
  try {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/diff/${encodeURIComponent(entry.fullHash)}`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const diffChunks = parseDiffChunks(data.diff);
    gitStore.diffChunks = diffChunks;
    gitStore.diffFullText = data.diff || "";
    expandedFiles.value = (data.files || []).map((f) => ({
      path: f.path || f.name,
      status: f.status || "M",
      numstat: buildFileNumstatHtml(f, diffChunks[f.path || f.name]),
    }));
  } catch (e) {
    console.error("commit files load failed:", e);
  } finally {
    expandedLoading.value = false;
  }
}

function closeExpanded() {
  expandedEntry.value = null;
  expandedFiles.value = [];
  vueEmit("commit:collapsed");
}

function selectExpandedFile(file) {
  bridgeEmit("git:selectDiffFile", { path: file.path });
}

async function reload() {
  await load();
}

onMounted(load);

function setActivePane(key) {
  activePane.value = key;
}

function hasExpanded() {
  return !!expandedEntry.value;
}

defineExpose({ reload, load, setActivePane, closeExpanded, hasExpanded });
</script>
