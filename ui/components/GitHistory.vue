<template>
  <div class="git-history-pane-wrapper">
    <!-- ファイル一覧モード -->
    <template v-if="selectedCommitForFiles">
      <div class="git-log-entry git-log-commit diff-files-selected-commit">
        <svg v-if="selectedCommitRow" class="git-graph-svg" :width="graphWidth" :height="GRAPH_ROW_HEIGHT" :viewBox="'0 0 ' + graphWidth + ' ' + GRAPH_ROW_HEIGHT">
          <template v-for="(seg, si) in selectedCommitRow.segments" :key="si">
            <line v-if="seg.type === 'line'" :x1="seg.x" :y1="seg.y1" :x2="seg.x2 ?? seg.x" :y2="seg.y2" :stroke="seg.color" stroke-width="2" />
            <circle v-if="seg.type === 'node'" :cx="seg.x" :cy="seg.y" r="4" :fill="seg.color" />
          </template>
        </svg>
        <span class="git-log-entry-body">
          <span class="git-log-entry-msg">{{ selectedCommitForFiles.message }}</span>
          <span class="git-log-entry-row1">
            <span class="git-log-entry-row1-left">
              <span v-if="selectedCommitForFiles.refs?.length" class="git-log-entry-refs">
                <span v-for="r in selectedCommitForFiles.refs" :key="r.label" class="git-ref" :class="'git-ref-' + r.type"><span v-if="r.synced" class="mdi mdi-link-variant"></span><span :class="'mdi ' + r.icon"></span>{{ r.label }}</span>
              </span>
            </span>
            <span class="git-log-entry-meta">
              <span class="git-log-entry-author">{{ selectedCommitForFiles.author }}</span>
              <span class="git-log-entry-time">{{ selectedCommitForFiles.time }}</span>
            </span>
          </span>
        </span>
        <button class="diff-files-close-btn" @click="closeSelectedCommitFiles">
          <span class="mdi mdi-close"></span>
        </button>
      </div>
      <div class="modal-scroll-body">
        <div v-if="isSelectedCommitFilesLoading" class="text-muted-center">Loading...</div>
        <ul v-if="!isSelectedCommitFilesLoading" class="file-browser-list diff-file-browser-list">
          <template v-for="file in selectedCommitFiles" :key="file.path">
            <FileItem
              class="diff-file-row"
              :label="file.path"
              :icon-html="fileIconHtml(file)"
              @click="onDiffFileClick(file)"
              @contextmenu="openDiffMenu(file)"
              @mouseenter="onDiffFileMouseEnter(file)"
              @mouseleave="onDiffFileMouseLeave"
              @mousedown="diffLongPress.startMenu($event, file)"
              @mouseup="diffLongPress.endMenu()"
              @touchstart="diffLongPress.startMenu($event, file)"
              @touchend="diffLongPress.endMenu()"
              @touchcancel="diffLongPress.endMenu()"
            >
              <template #right>
                <span v-if="file.numstat" class="diff-file-row-numstat" v-html="file.numstat"></span>
                <span :class="['diff-file-row-status', statusClass(file.status)]">{{ file.status }}</span>
              </template>
            </FileItem>
            <FileActionMenu
              v-if="diffContextEntry?.path === file.path"
              :actions="diffMenuActions"
              @menu-enter="onDiffMenuMouseEnter"
              @menu-leave="onDiffMenuMouseLeave"
            />
          </template>
        </ul>
      </div>
    </template>
    <!-- コミット履歴モード -->
    <div v-else class="modal-scroll-body" ref="historyListEl" @scroll.passive="onHistoryListScroll">
      <div v-if="isHistoryLoading" class="text-muted-center">Loading...</div>
      <div v-else-if="commitEntries.length === 0" class="text-muted-center">No commit history</div>
      <!-- Changes -->
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
import { ref, computed, onMounted } from "vue";

import FileItem from "./FileItem.vue";
import FileActionMenu from "./FileActionMenu.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { useLongPress } from "../composables/useLongPress.js";
import { useHoverMenu, isHoverDevice } from "../composables/useHoverMenu.js";
import { useGitHistoryAction } from "../composables/useGitHistoryAction.js";
import { useGitDiff } from "../composables/useGitDiff.js";
import { useGitLogPagination } from "../composables/useGitLogPagination.js";
import { useEditorIntegration } from "../composables/useEditorIntegration.js";
import { useAuthStore } from "../stores/auth.js";
import { renderFileIconFromPath } from "../utils/file-icon.js";
import { GIT_DIFF_STATUS_CLASSES } from "../utils/constants.js";
import { GRAPH_ROW_HEIGHT } from "../utils/git-graph.js";
import { workspaceGitDiscardPath, workspaceDownloadPath } from "../utils/endpoints.js";
import { triggerBlobDownload } from "../utils/download.js";

const emitToParent = defineEmits(["commit:expanded", "commit:collapsed"]);

const workspaceStore = useWorkspaceStore();
const { apiCommand, wsEndpoint } = useApi();
const { editorUrlTemplate, fetchEditorSettings, openInEditor } = useEditorIntegration();
const auth = useAuthStore();
const { execAction: execCommitAction, execReset: execCommitReset, execCreateBranch: execCommitCreateBranch, execMerge: execCommitMerge, execRebase: execCommitRebase } = useGitHistoryAction();
const { fetchWorkingTreeDiff, fetchCommitDiff } = useGitDiff();
const isDirty = computed(() => workspaceStore.currentWorkspace && workspaceStore.currentWorkspace.clean === false);

const {
  graphRows, commitEntries, graphWidth,
  isHistoryLoading, hasMoreHistory, isLoadingMoreHistory,
  historyListEl, loadHistory, loadMoreHistory, onHistoryListScroll,
} = useGitLogPagination();

const selectedCommitForFiles = ref(null);
const selectedCommitFiles = ref([]);
const isSelectedCommitFilesLoading = ref(false);

const selectedCommitRow = computed(() =>
  graphRows.value.find((r) => r.entry?.hash === selectedCommitForFiles.value?.hash) ?? null
);

function statusClass(status) {
  return GIT_DIFF_STATUS_CLASSES[status] || "";
}

function fileIconHtml(file) {
  return renderFileIconFromPath(file.path);
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
  const dirtyEntry = { message: "Changes", author: "", time: "", hash: "__dirty__", fullHash: "__dirty__" };
  openDiffFiles(dirtyEntry, fetchWorkingTreeDiff);
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

const diffLongPress = useLongPress();
const {
  contextEntry: diffContextEntry,
  openMenu: openDiffMenu,
  closeMenu: closeDiffMenu,
  onItemMouseEnter: onDiffFileMouseEnter,
  onItemMouseLeave: onDiffFileMouseLeave,
  onMenuMouseEnter: onDiffMenuMouseEnter,
  onMenuMouseLeave: onDiffMenuMouseLeave,
} = useHoverMenu();

const isWorkingTreeDiff = computed(() => selectedCommitForFiles.value?.hash === "__dirty__");

const diffMenuActions = computed(() => {
  const file = diffContextEntry.value;
  if (!file) return [];
  return [
    { icon: "mdi-file-document-outline", label: "View diff", handler: () => viewDiffFile(file) },
    { icon: "mdi-file-edit-outline", label: "Editor", show: !!editorUrlTemplate.value, handler: () => { openInEditor(file.path); closeDiffMenu(); } },
    { icon: "mdi-download", label: "Download", handler: () => downloadDiffFile(file) },
    { icon: "mdi-github", label: "GitHub", show: !!diffFileGithubUrl(file), handler: () => openDiffFileGithub(file) },
    { icon: "mdi-undo", label: "Discard", show: isWorkingTreeDiff.value, danger: true, handler: () => discardDiffFile(file) },
    { icon: "mdi-delete-outline", label: "Delete", show: isWorkingTreeDiff.value, danger: true, handler: () => deleteDiffFile(file) },
  ];
});

function onDiffFileClick(file) {
  if (!isHoverDevice) {
    if (diffLongPress.consumeFired()) return;
    if (diffContextEntry.value?.path === file.path) {
      closeDiffMenu();
      selectCommitDiffFile(file);
      return;
    }
    openDiffMenu(file);
    return;
  }
  selectCommitDiffFile(file);
}

function viewDiffFile(file) {
  closeDiffMenu();
  selectCommitDiffFile(file);
}

async function _execDiffFileAction(file, endpoint, errorMessage, successMessage = null) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  closeDiffMenu();
  const { ok } = await apiCommand(endpoint, { path: file.path }, { errorMessage });
  if (ok) {
    if (successMessage) bridgeEmit("toast:show", { message: successMessage, type: "success" });
    bridgeEmit("git:refreshStatus");
    openWorkingTreeDiffFiles();
  }
}

async function discardDiffFile(file) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  await _execDiffFileAction(file, workspaceGitDiscardPath(workspace), `Failed to discard ${file.path}`);
}

function openDiffFileGithub(file) {
  const url = diffFileGithubUrl(file);
  if (url) window.open(url, "_blank");
  closeDiffMenu();
}

function diffFileGithubUrl(file) {
  const ws = workspaceStore.currentWorkspace;
  if (!ws?.github_url) return "";
  const ref = isWorkingTreeDiff.value
    ? (ws.branch || "main")
    : (selectedCommitForFiles.value?.fullHash || "");
  if (!ref) return "";
  return `${ws.github_url}/blob/${ref}/${file.path}`;
}

async function downloadDiffFile(file) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  closeDiffMenu();
  try {
    const res = await auth.apiFetch(workspaceDownloadPath(workspace, file.path));
    if (!res?.ok) { bridgeEmit("toast:show", { message: "Download failed", type: "error" }); return; }
    const blob = await res.blob();
    triggerBlobDownload(blob, file.path.split("/").pop() || "download");
  } catch {
    bridgeEmit("toast:show", { message: "Download failed", type: "error" });
  }
}

async function deleteDiffFile(file) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  await _execDiffFileAction(file, wsEndpoint(workspace, "delete-file"), "Delete failed", "Deleted");
}

function selectCommitDiffFile(file) {
  bridgeEmit("git:selectDiffFile", { path: file.path });
}

async function reloadHistory() {
  await loadHistory();
}

onMounted(() => {
  loadHistory();
  fetchEditorSettings();
});

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

.diff-files-selected-commit {
  flex-shrink: 0;
  background: rgba(130, 170, 255, 0.06);
  border-bottom: 1px solid var(--border);
}

.diff-files-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--white-30);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
  min-height: 0;
  min-width: 0;
}

.git-history-pane-wrapper > .modal-scroll-body {
}

.git-log-entry {
  display: flex;
  align-items: flex-start;
  font-size: 13px;
}

.git-log-commit {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  gap: 2px;
}

.git-log-entry-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
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

.file-browser-action-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
}

.file-browser-action-menu button {
  padding: 5px 10px;
  font-size: 11px;
  min-height: 0;
}

.file-browser-action-delete {
  color: var(--error);
  border-color: var(--error);
}

</style>
