<template>
  <div class="git-history-pane-wrapper">
    <!-- ファイル一覧モード -->
    <template v-if="selectedCommitForFiles">
      <div v-if="isDirtyDiff" class="stash-pane-toolbar">
        <button type="button" class="stash-save-btn" @click="stashSave">stash save</button>
      </div>
      <div class="modal-scroll-body">
        <div v-if="isSelectedCommitFilesLoading" class="text-muted-center">読み込み中...</div>
        <ul v-if="!isSelectedCommitFilesLoading" class="file-browser-list diff-file-browser-list">
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
      <div v-if="isHistoryLoading" class="text-muted-center">読み込み中...</div>
      <div v-else-if="commitEntries.length === 0" class="text-muted-center">コミットログがありません</div>
      <!-- 変更あり -->
      <div v-if="!isHistoryLoading && commitEntries.length > 0" class="git-log-dirty" @click="isDirty ? openWorkingTreeDiffFiles() : selectPane('stash')">
        <button type="button" class="git-log-branch-btn" @click.stop="selectPane('branch')">
          <span class="mdi mdi-source-branch"></span>{{ currentBranch }}
        </button>
        <span class="git-log-dirty-status">
          <span class="git-log-dirty-label">{{ isDirty ? '変更あり' : '変更なし' }}</span>
          <span v-if="isDirty" class="git-log-dirty-numstat" v-html="dirtySummaryHtml"></span>
        </span>
        <button v-if="githubUrl" type="button" class="git-action-btn icon-only git-log-dirty-github" title="GitHub" @click.stop="selectPane('github')">
          <span class="mdi mdi-github"></span>
        </button>
      </div>
      <template v-for="(row, idx) in graphRows" :key="idx">
        <div
          class="git-log-entry git-log-commit long-press-surface"
          :class="{ 'action-open': row.entry && longPressEntry?.hash === row.entry.hash, 'git-log-graph-only': !row.entry }"
          @click="row.entry && openCommitDiffFiles(row.entry)"
          @mousedown="row.entry && onLongPressStart($event, row.entry)"
          @mouseup="onLongPressEnd"
          @mouseleave="onLongPressEnd"
          @touchstart.passive="row.entry && onLongPressStart($event, row.entry)"
          @touchend="onLongPressEnd"
          @touchcancel="onLongPressEnd"
          @contextmenu.prevent="row.entry && toggleActionMenu(row.entry)"
        >
          <svg class="git-graph-svg" :width="graphWidth" :height="GRAPH_ROW_HEIGHT" :viewBox="'0 0 ' + graphWidth + ' ' + GRAPH_ROW_HEIGHT">
            <template v-for="(seg, si) in row.segments" :key="si">
              <line v-if="seg.type === 'line'" :x1="seg.x" :y1="seg.y1" :x2="seg.x2 ?? seg.x" :y2="seg.y2" :stroke="seg.color" stroke-width="2" />
              <circle v-if="seg.type === 'node'" :cx="seg.x" :cy="seg.y" r="4" :fill="seg.color" />
            </template>
          </svg>
          <span v-if="row.entry" class="git-log-entry-body">
            <span class="git-log-entry-msg">{{ row.entry.message }}</span>
            <span class="git-log-entry-row1">
              <span class="git-log-entry-row1-left">
                <span v-if="row.entry.refs.length" class="git-log-entry-refs">
                  <span v-for="r in row.entry.refs" :key="r.label" class="git-ref" :class="'git-ref-' + r.type"><span v-if="r.synced" class="mdi mdi-link-variant"></span><span :class="'mdi ' + r.icon"></span>{{ r.label }}</span>
                </span>
              </span>
              <span class="git-log-entry-meta">
                <span class="git-log-entry-author">{{ row.entry.author }}</span>
                <span class="git-log-entry-time">{{ row.entry.time }}</span>
              </span>
            </span>
          </span>
        </div>
        <div v-if="row.entry && longPressEntry?.hash === row.entry.hash" class="commit-action-menu">
          <button type="button" class="modal-action-btn" @click="execAction('cherry-pick', row.entry)">cherry-pick</button>
          <button type="button" class="modal-action-btn" @click="execAction('revert', row.entry)">revert</button>
          <button type="button" class="modal-action-btn" @click="execCreateBranch(row.entry)">branch</button>
          <button v-for="b in entryBranches(row.entry)" :key="'merge-'+b" type="button" class="modal-action-btn" @click="execMerge(b)">merge {{ b }}</button>
          <button v-for="b in entryBranches(row.entry)" :key="'rebase-'+b" type="button" class="modal-action-btn" @click="execRebase(b)">rebase {{ b }}</button>
          <button type="button" class="modal-action-btn" @click="execReset(row.entry, 'soft')">reset --soft</button>
          <button type="button" class="modal-action-btn commit-action-danger" @click="execReset(row.entry, 'hard')">reset --hard</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from "vue";

import FileItem from "./FileItem.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore } from "../stores/git.js";
import { useApi } from "../composables/useApi.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useGitCommitAction } from "../composables/useGitCommitAction.js";
import { useGitDiff } from "../composables/useGitDiff.js";
import { renderFileIconFromPath } from "../utils/file-icon.js";
import { GIT_DIFF_STATUS_CLASSES, INFINITE_SCROLL_THRESHOLD_PX } from "../utils/constants.js";
import { GRAPH_ROW_HEIGHT, parseGitGraphOutput, buildGitGraphRows, computeGraphWidth } from "../utils/git-graph.js";

const emitToParent = defineEmits(["pane:select", "commit:expanded", "commit:collapsed"]);

const workspaceStore = useWorkspaceStore();
const { apiGet, apiCommand, wsEndpoint } = useApi();
const { execAction: execCommitAction, execReset: execCommitReset, execCreateBranch: execCommitCreateBranch, execMerge: execCommitMerge, execRebase: execCommitRebase } = useGitCommitAction();
const { fetchWorkingTreeDiff, fetchCommitDiff } = useGitDiff();
const gitStore = useGitStore();

const activePane = ref("browser");

function selectPane(key) {
  activePane.value = key;
  emitToParent("pane:select", key);
}

const isDirty = computed(() => workspaceStore.currentWorkspace && workspaceStore.currentWorkspace.clean === false);
const currentBranch = computed(() => workspaceStore.currentWorkspace?.branch || "");
const isDirtyDiff = computed(() => selectedCommitForFiles.value?.hash === "__dirty__");
const githubUrl = computed(() => workspaceStore.currentWorkspace?.github_url || "");
const dirtySummaryHtml = computed(() => {
  const ws = workspaceStore.currentWorkspace;
  if (!ws || ws.clean !== false) return "";
  const changedFiles = ws.changed_files || 0;
  const insertions = ws.insertions || 0;
  const deletions = ws.deletions || 0;
  const fileCountHtml = changedFiles > 0 ? `<span class="header-git-files">${changedFiles}F</span>` : "";
  return `${fileCountHtml}<span class="diff-num-plus">+${insertions}</span><span class="diff-num-del">-${deletions}</span>`;
});

const graphRows = ref([]);
const commitEntries = computed(() => graphRows.value.filter((r) => r.entry).map((r) => r.entry));
const graphWidth = computed(() => computeGraphWidth(graphRows.value));
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

async function loadHistory() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) { isHistoryLoading.value = false; return; }
  isHistoryLoading.value = true;
  hasMoreHistory.value = false;
  isLoadingMoreHistory.value = false;
  historyPage = 0;
  try {
    const perPage = gitStore.GIT_LOG_ENTRIES_PER_PAGE;
    const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${perPage}&skip=0&graph=true`));
    if (!ok) { isHistoryLoading.value = false; return; }
    const parsed = parseGitGraphOutput(data.stdout);
    graphRows.value = buildGitGraphRows(parsed);
    hasMoreHistory.value = parsed.filter((p) => p.entry).length >= perPage;
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
  const totalLimit = (historyPage + 1) * perPage;
  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${totalLimit}&skip=0&graph=true`));
    if (!ok) return;
    const parsed = parseGitGraphOutput(data.stdout);
    graphRows.value = buildGitGraphRows(parsed);
    hasMoreHistory.value = parsed.filter((p) => p.entry).length >= totalLimit;
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

const { activeEntry: longPressEntry, startMenu: onLongPressStart, endMenu: onLongPressEnd, closeMenu: closeLongPressMenu, isFired: isLongPressFired, isMenuEl } = useLongPress();

function toggleActionMenu(entry) {
  if (longPressEntry.value?.hash === entry.hash) {
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

function entryBranches(entry) {
  return entry.refs
    .filter((r) => r.type === "branch" || r.type === "remote")
    .map((r) => r.label);
}

function execCreateBranch(entry) {
  execCommitCreateBranch(entry, closeLongPressMenu);
}

function execMerge(branch) {
  execCommitMerge(branch, closeLongPressMenu);
}

function execRebase(branch) {
  execCommitRebase(branch, closeLongPressMenu);
}

async function openDiffFiles(entry, fetchFn) {
  selectedCommitForFiles.value = entry;
  emitToParent("commit:expanded", { message: entry.message });
  selectedCommitFiles.value = [];
  isSelectedCommitFilesLoading.value = true;
  try {
    const result = await fetchFn();
    if (!result) return;
    selectedCommitFiles.value = result.fileList;
  } catch (e) {
    console.error("diff files load failed:", e);
  } finally {
    isSelectedCommitFilesLoading.value = false;
  }
}

function openWorkingTreeDiffFiles() {
  if (!isDirty.value) return;
  const dirtyEntry = { message: "変更あり", author: "", time: "", hash: "__dirty__", fullHash: "__dirty__" };
  openDiffFiles(dirtyEntry, fetchWorkingTreeDiff);
}

async function stashSave() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true });
  if (!ok) return;
  closeSelectedCommitFiles();
  bridgeEmit("git:commitDone");
}

function openCommitDiffFiles(entry) {
  if (isMenuEl() || isLongPressFired()) return;
  if (longPressEntry.value) closeLongPressMenu();
  openDiffFiles(entry, () => fetchCommitDiff(entry.fullHash));
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
}

.git-log-entry {
  display: flex;
  align-items: flex-start;
  font-size: 13px;
}

.git-log-dirty {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  gap: 8px;
  cursor: pointer;
}

.git-log-commit {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  gap: 2px;
}

.git-log-branch-btn {
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  gap: 2px;
  padding: 0 10px;
  font-size: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
  flex-shrink: 0;
}

.git-log-entry-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.git-log-pane-actions {
  display: flex;
  padding: 8px;
  gap: 6px;
  border-bottom: 1px solid var(--border);
}

.git-log-pane-actions .git-action-btn {
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

.git-log-pane-actions .git-action-btn.icon-only {
  color: var(--text-muted);
  background: var(--bg-tertiary);
}

.stash-pane-toolbar {
  padding: 0 0 8px;
  flex-shrink: 0;
}

.stash-save-btn {
  width: 100%;
  min-height: 36px;
  padding: 0 12px;
  font-size: 13px;
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.git-log-dirty-status {
  display: flex;
  align-items: center;
  align-self: stretch;
  flex: 1;
  min-width: 0;
  padding: 0 10px;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-tertiary);
  cursor: pointer;
  gap: 8px;
}

.git-log-dirty-label {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

.git-log-dirty-numstat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}

.git-log-dirty-numstat :deep(.header-git-files) {
  color: var(--warning);
}

.git-log-dirty-github {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  padding: 0 8px;
  border-radius: var(--radius);
  font-size: 14px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--bg-tertiary);
  cursor: pointer;
  flex-shrink: 0;
}

.git-log-entry-msg {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #fff;
  user-select: none;
  -webkit-user-select: none;
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


.git-graph-svg {
  flex-shrink: 0;
}

.git-log-graph-only {
  min-height: 28px;
  padding-top: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.git-log-commit.action-open,
.diff-file-row.action-open {
  background: rgba(130, 170, 255, 0.08);
}

</style>
