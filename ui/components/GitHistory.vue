<template>
  <div class="git-history-pane-wrapper">
    <!-- ファイル一覧モード -->
    <template v-if="selectedCommitForFiles">
      <div class="modal-scroll-body">
        <div v-if="isSelectedCommitFilesLoading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
        <ul v-else class="file-browser-list diff-file-browser-list">
          <FileItem
            v-for="file in selectedCommitFiles"
            :key="file.path"
            class="diff-file-row"
            :label="file.path"
            :icon-html="fileIconHtml(file)"
            @click="selectCommitDiffFile(file)"
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
    <div v-else class="modal-scroll-body" ref="historyListEl" @scroll.passive="onHistoryListScroll">
      <div v-if="isHistoryLoading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <div v-else-if="commitEntries.length === 0" style="color:var(--text-muted);padding:16px;text-align:center">コミットログがありません</div>
      <!-- 未コミットの変更 / 変更なし -->
      <div v-if="!isHistoryLoading && commitEntries.length > 0" class="git-log-entry git-log-dirty" @click="openWorkingTreeDiffFiles">
        <span class="git-log-entry-body git-log-dirty-body">
          <span class="git-log-dirty-main">
            <span class="git-log-entry-msg git-log-dirty-msg">{{ isDirty ? '未コミットの変更' : '変更なし' }}</span>
            <span class="git-log-entry-refs" :class="{ 'git-dirty-spacer': !isDirty }">
              <span class="git-ref git-ref-dirty" v-html="dirtySummaryHtml"></span>
            </span>
          </span>
        </span>
        <div class="git-log-dirty-actions" @click.stop>
          <button type="button" class="git-action-btn icon-only" title="Stash" @click="selectPane('stash')">
            <span class="mdi mdi-package-down"></span>
          </button>
          <button type="button" class="git-action-btn icon-only" title="ブランチ" @click="selectPane('branch')">
            <span class="mdi mdi-source-branch"></span>
          </button>
          <button type="button" class="git-action-btn icon-only" title="コミットグラフ" @click="selectPane('graph')">
            <span class="mdi mdi-source-branch-sync"></span>
          </button>
          <button v-if="githubUrl" type="button" class="git-action-btn icon-only" title="GitHub" @click="selectPane('github')">
            <span class="mdi mdi-github"></span>
          </button>
        </div>
      </div>
      <template v-for="entry in commitEntries" :key="entry.hash">
        <div
          class="git-log-entry git-log-commit long-press-surface"
          :class="{ 'action-open': longPressEntry?.hash === entry.hash }"
          @click="openCommitDiffFiles(entry)"
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
                  <span v-for="r in entry.refs" :key="r.label" class="git-ref" :class="'git-ref-' + r.type"><span v-if="r.synced" class="mdi mdi-link-variant"></span><span :class="'mdi ' + r.icon"></span>{{ r.label }}</span>
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
          <button type="button" class="modal-action-btn" @click="execCreateBranch(entry)">branch</button>
          <button v-for="b in entryBranches(entry)" :key="'merge-'+b" type="button" class="modal-action-btn" @click="execMerge(b)">merge {{ b }}</button>
          <button v-for="b in entryBranches(entry)" :key="'rebase-'+b" type="button" class="modal-action-btn" @click="execRebase(b)">rebase {{ b }}</button>
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

const emitToParent = defineEmits(["pane:select", "commit:expanded", "commit:collapsed"]);

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const activePane = ref("browser");

function selectPane(key) {
  activePane.value = key;
  emitToParent("pane:select", key);
}

const currentWorkspaceState = computed(() =>
  workspaceStore.allWorkspaces.find((w) => w.name === workspaceStore.selectedWorkspace),
);
const isDirty = computed(() => currentWorkspaceState.value && currentWorkspaceState.value.clean === false);
const githubUrl = computed(() => currentWorkspaceState.value?.github_url || "");
const dirtySummaryHtml = computed(() => {
  const ws = currentWorkspaceState.value;
  if (!ws || ws.clean !== false) return "0F +0 -0";
  const parts = [];
  if (ws.changed_files > 0) parts.push(`<span class="stat-files">${ws.changed_files}F</span>`);
  if (ws.insertions > 0) parts.push(`<span class="stat-add">+${ws.insertions}</span>`);
  if (ws.deletions > 0) parts.push(`<span class="stat-del">-${ws.deletions}</span>`);
  return parts.length > 0 ? parts.join(" ") : "\u25cf";
});

const commitEntries = ref([]);
const isHistoryLoading = ref(true);
const hasMoreHistory = ref(false);
const isLoadingMoreHistory = ref(false);
const historyListEl = ref(null);
let historyPage = 0;

const selectedCommitForFiles = ref(null);
const selectedCommitFiles = ref([]);
const isSelectedCommitFilesLoading = ref(false);

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

async function loadHistory() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) { isHistoryLoading.value = false; return; }
  isHistoryLoading.value = true;
  hasMoreHistory.value = false;
  isLoadingMoreHistory.value = false;
  historyPage = 0;
  try {
    const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=0`);
    if (!res || !res.ok) { isHistoryLoading.value = false; return; }
    const data = await res.json();
    commitEntries.value = parseGitLogEntries(data.stdout);
    hasMoreHistory.value = commitEntries.value.length >= perPage;
  } catch (e) {
    console.error("git log load failed:", e);
  } finally {
    isHistoryLoading.value = false;
    nextTick(() => onHistoryListScroll());
  }
}

async function loadMoreHistory() {
  if (isHistoryLoading.value || isLoadingMoreHistory.value || !hasMoreHistory.value) return;
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  isLoadingMoreHistory.value = true;
  historyPage++;
  const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/git-log?limit=${perPage}&skip=${historyPage * perPage}`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const newEntries = parseGitLogEntries(data.stdout);
    commitEntries.value = [...commitEntries.value, ...newEntries];
    hasMoreHistory.value = newEntries.length >= perPage;
  } catch (e) {
    console.error("git log loadMore failed:", e);
  } finally {
    isLoadingMoreHistory.value = false;
    nextTick(() => onHistoryListScroll());
  }
}

function onHistoryListScroll() {
  if (!hasMoreHistory.value || isHistoryLoading.value || isLoadingMoreHistory.value) return;
  const el = historyListEl.value;
  if (!el) return;
  const threshold = INFINITE_SCROLL_THRESHOLD_PX;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
    loadMoreHistory();
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

function entryBranches(entry) {
  return entry.refs
    .filter((r) => r.type === "branch" || r.type === "remote")
    .map((r) => r.label);
}

async function execCreateBranch(entry) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const branchName = prompt("新しいブランチ名を入力してください:");
  if (!branchName) return;
  closeLongPressMenu();
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/create-branch`, {
      method: "POST",
      body: { branch: branchName, start_point: entry.fullHash },
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      bridgeEmit("toast:show", { message: data?.detail || "ブランチ作成に失敗しました", type: "error" });
      return;
    }
    bridgeEmit("toast:show", { message: `ブランチ ${branchName} を作成しました`, type: "success" });
    bridgeEmit("git:refresh");
  } catch (e) {
    bridgeEmit("toast:show", { message: e.message, type: "error" });
  }
}

async function execMerge(branch) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  if (!confirm(`${branch} を現在のブランチにマージしますか？`)) return;
  closeLongPressMenu();
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/merge`, {
      method: "POST",
      body: { branch },
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      bridgeEmit("toast:show", { message: data?.detail || "マージに失敗しました", type: "error" });
      return;
    }
    bridgeEmit("toast:show", { message: `${branch} をマージしました`, type: "success" });
    bridgeEmit("git:refresh");
  } catch (e) {
    bridgeEmit("toast:show", { message: e.message, type: "error" });
  }
}

async function execRebase(branch) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  if (!confirm(`${branch} にリベースしますか？`)) return;
  closeLongPressMenu();
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/rebase`, {
      method: "POST",
      body: { branch },
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      bridgeEmit("toast:show", { message: data?.detail || "リベースに失敗しました", type: "error" });
      return;
    }
    bridgeEmit("toast:show", { message: `${branch} にリベースしました`, type: "success" });
    bridgeEmit("git:refresh");
  } catch (e) {
    bridgeEmit("toast:show", { message: e.message, type: "error" });
  }
}

async function openWorkingTreeDiffFiles() {
  if (!isDirty.value) return;
  selectedCommitForFiles.value = { message: "未コミットの変更", author: "", time: "", hash: "__dirty__", fullHash: "__dirty__" };
  emitToParent("commit:expanded", { message: selectedCommitForFiles.value.message });
  selectedCommitFiles.value = [];
  isSelectedCommitFilesLoading.value = true;
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
    gitStore.diffFileStatuses = Object.fromEntries(fileList.map((f) => [f.path, f.status]));
    selectedCommitFiles.value = fileList.map((f) => ({
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
    isSelectedCommitFilesLoading.value = false;
  }
}

async function openCommitDiffFiles(entry) {
  if (longPressEl || longPressEntry.value || longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  selectedCommitForFiles.value = entry;
  emitToParent("commit:expanded", { message: entry.message });
  selectedCommitFiles.value = [];
  isSelectedCommitFilesLoading.value = true;
  try {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/diff/${encodeURIComponent(entry.fullHash)}`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const diffChunks = parseDiffChunks(data.diff);
    gitStore.diffChunks = diffChunks;
    gitStore.diffFullText = data.diff || "";
    const fileList = (data.files || []).map((f) => ({
      path: f.path || f.name,
      status: f.status || "M",
    }));
    gitStore.diffFileStatuses = Object.fromEntries(fileList.map((f) => [f.path, f.status]));
    selectedCommitFiles.value = fileList.map((f) => ({
      ...f,
      numstat: buildFileNumstatHtml(f, diffChunks[f.path]),
    }));
  } catch (e) {
    console.error("commit files load failed:", e);
  } finally {
    isSelectedCommitFilesLoading.value = false;
  }
}

function closeSelectedCommitFiles() {
  selectedCommitForFiles.value = null;
  selectedCommitFiles.value = [];
  emitToParent("commit:collapsed");
}

function selectCommitDiffFile(file) {
  bridgeEmit("git:selectDiffFile", { path: file.path });
}

async function reloadHistory() {
  await loadHistory();
}

onMounted(loadHistory);

function setActivePane(key) {
  activePane.value = key;
}

function hasSelectedCommitFiles() {
  return !!selectedCommitForFiles.value;
}

defineExpose({
  reload: reloadHistory,
  load: loadHistory,
  setActivePane,
  closeExpanded: closeSelectedCommitFiles,
  hasExpanded: hasSelectedCommitFiles,
});
</script>

<style scoped>
.git-history-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.git-history-pane-wrapper > .modal-scroll-body {
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.git-log-entry {
  display: flex;
  align-items: flex-start;
  font-size: 13px;
}

.git-log-commit,
.git-log-dirty {
  display: flex;
  align-items: center;
  padding: 10px 8px;
  border-bottom: 1px solid var(--border);
  gap: 8px;
}

.git-log-commit:last-child {
  border-bottom: none;
}

.git-log-entry-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.git-log-dirty-body {
  flex-direction: row;
  align-items: stretch;
  gap: 8px;
  cursor: pointer;
}

.git-log-dirty-main {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  flex: 1;
  gap: 4px;
  min-height: 42px;
}

.git-dirty-spacer {
  visibility: hidden;
  pointer-events: none;
}

.git-log-dirty-actions {
  display: flex;
  align-self: stretch;
  flex-shrink: 0;
  gap: 6px;
  min-height: 42px;
}

.git-log-dirty-actions :deep(.git-action-btn) {
  flex-shrink: 0;
}

.git-log-dirty-actions .git-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  border-radius: var(--radius);
  font-size: 14px;
  border: 1px solid var(--border);
  cursor: pointer;
}

.git-log-dirty-actions .git-action-btn.icon-only {
  color: var(--text-muted);
  background: var(--bg-tertiary);
}

.git-log-entry-msg {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #fff;
  user-select: none;
  -webkit-user-select: none;
}

.git-log-dirty-msg {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted) !important;
}

.git-log-entry-row1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.git-log-entry-row1-left {
  min-width: 0;
  overflow: hidden;
}

.git-log-entry-refs {
  display: flex;
  gap: 4px;
  flex-wrap: nowrap;
  overflow: hidden;
}

.git-log-entry-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.git-log-entry-author {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.git-log-entry-time {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
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


.git-ref-dirty {
  display: inline-flex;
  align-items: center;
  min-height: 0;
  padding: 4px 10px;
  color: var(--warning);
  background: var(--warning-bg-20);
}

.git-ref-dirty :deep(.header-git-numstat) {
  font-size: 10px;
  gap: 8px;
}

.git-ref-dirty :deep(.header-git-files) {
  font-size: 10px;
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

.git-log-commit.action-open,
.diff-file-row.action-open {
  background: rgba(130, 170, 255, 0.08);
}

.diff-file-browser-list {
  flex: 1;
}

.diff-file-row {
  cursor: pointer;
}

.diff-file-row :deep(.file-browser-item-name) {
  font-size: 12px;
}

.diff-file-row-status {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  min-width: 28px;
  text-align: center;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.diff-file-row-status.diff-status-mod {
  color: #8cb6ff;
  border-color: rgba(140, 182, 255, 0.45);
  background: rgba(140, 182, 255, 0.12);
}

.diff-file-row-status.diff-status-add {
  color: #7edb9a;
  border-color: rgba(126, 219, 154, 0.45);
  background: rgba(126, 219, 154, 0.12);
}

.diff-file-row-status.diff-status-del {
  color: #ff8e9a;
  border-color: rgba(255, 142, 154, 0.45);
  background: rgba(255, 142, 154, 0.12);
}

.diff-file-row-status.diff-status-ren {
  color: #ffd27a;
  border-color: rgba(255, 210, 122, 0.45);
  background: rgba(255, 210, 122, 0.12);
}

.diff-file-row-numstat {
  display: inline-flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 8px;
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  white-space: nowrap;
}
</style>
