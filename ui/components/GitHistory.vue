<template>
  <div class="git-history-pane-wrapper pane-fill">
    <!-- ファイル一覧モード -->
    <template v-if="selectedCommitForFiles">
      <div class="git-log-entry git-log-commit diff-files-selected-commit">
        <span class="git-log-entry-body">
          <span class="git-log-entry-msg-row">
            <button type="button" class="diff-files-close-btn" aria-label="Back to history" data-tooltip="Back" @click.stop="closeSelectedCommitFiles">
              <span class="mdi mdi-arrow-left"></span>
            </button>
            <span
              class="git-log-entry-msg git-log-entry-msg-toggle"
              :class="{ 'git-log-entry-msg-expanded': commitDetailExpanded }"
              role="button"
              tabindex="0"
              :aria-expanded="commitDetailExpanded"
              aria-label="Toggle full commit message"
              data-tooltip="Show full message"
              @click.stop="commitDetailExpanded = !commitDetailExpanded"
              @keydown.enter.space.stop.prevent="commitDetailExpanded = !commitDetailExpanded"
            >{{ commitDetailExpanded ? selectedCommitFullMessage : selectedCommitForFiles.message }}</span>
          </span>
          <span class="git-log-entry-row1">
            <span class="git-log-entry-row1-left">
              <GitRefBadges :refs="selectedCommitForFiles.refs || []" />
            </span>
            <span class="git-log-entry-meta">
              <span class="git-log-entry-author">{{ selectedCommitForFiles.author }}</span>
              <span class="git-log-entry-time">{{ selectedCommitForFiles.time }}</span>
            </span>
          </span>
          <CommitActionMenu
            v-if="selectedCommitForFiles.hash !== '__dirty__'"
            :branches="entryBranches(selectedCommitForFiles)"
            @click.stop
            @copy-hash="copySelectedCommitHash"
            @exec="onCommitAction(selectedCommitForFiles, $event)"
          />
        </span>
      </div>
      <div class="modal-scroll-body">
        <div v-if="isSelectedCommitFilesLoading" class="text-muted-center">Loading...</div>
        <ul v-if="!isSelectedCommitFilesLoading" class="file-browser-list diff-file-browser-list">
          <template v-for="file in selectedCommitFiles" :key="file.path">
            <DiffFileItem :file="file" @click="onDiffFileClick(file)" />
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
          class="git-log-entry git-log-commit"
          :class="{ 'git-log-graph-only': !row.entry, 'git-log-entry-pending': row.entry?.pending, 'git-log-entry-unpushed': row.entry?.unpushed }"
          :data-tooltip="row.entry?.pending ? 'Not pulled yet' : row.entry?.unpushed ? 'Not pushed yet' : null"
          @click="row.entry && openCommitDiffFiles(row.entry)"
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
                <GitRefBadges :refs="row.entry.refs" />
              </span>
              <span class="git-log-entry-meta">
                <span class="git-log-entry-author">{{ row.entry.author }}</span>
                <span class="git-log-entry-time">{{ row.entry.time }}</span>
              </span>
            </span>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import DiffFileItem from "./DiffFileItem.vue";
import GitRefBadges from "./GitRefBadges.vue";
import CommitActionMenu from "./CommitActionMenu.vue";
import { useGitDiff } from "../composables/useGitDiff.ts";
import { useGitLogPagination } from "../composables/useGitLogPagination.ts";
import { useCommitDiffFiles } from "../composables/useCommitDiffFiles.ts";
import { useCommitActionMenu } from "../composables/useCommitActionMenu.ts";
import { useDiffFileActions } from "../composables/useDiffFileActions.ts";
import { GRAPH_ROW_HEIGHT } from "../utils/git-graph.ts";
import { entryBranches } from "../utils/git.ts";

const emitToParent = defineEmits(["commit:expanded", "commit:collapsed"]);

const { fetchCommitDiff } = useGitDiff();

const {
  graphRows, commitEntries, graphWidth, isHistoryLoading,
  historyListEl, loadHistory, onHistoryListScroll,
} = useGitLogPagination();

const {
  selectedCommit: selectedCommitForFiles,
  files: selectedCommitFiles,
  isLoading: isSelectedCommitFilesLoading,
  openDiffFiles: openDiffFilesBase,
  close: closeDiffFilesState,
} = useCommitDiffFiles();

// GitHistory では closeFn（第3引数）を渡さない呼び方のため、その形に型を絞る
// （実行時は従来どおり同じ関数をそのまま呼ぶ）。
const { onCommitAction } = useCommitActionMenu() as {
  onCommitAction: (entry: Record<string, any>, ev: { action: string, branch?: string }) => void,
};

// Moreを押すとコミットメッセージ表示を切り詰め表示からフル本文へ差し替える
// （commit-message API からハッシュ単位で取得。GitHistory.vue側で状態を持ち、
// コミットを切り替えたら折りたたみ直す）。
const commitDetailExpanded = ref(false);

function openDiffFiles(entry: Record<string, any>, fetchFn: () => Promise<any>) {
  commitDetailExpanded.value = false;
  emitToParent("commit:expanded", { message: entry.message });
  return openDiffFilesBase(entry, fetchFn);
}

function openCommitDiffFiles(entry: Record<string, any>) {
  openDiffFiles(entry, () => fetchCommitDiff(entry.fullHash));
}

function closeSelectedCommitFiles() {
  closeDiffFilesState();
  commitDetailExpanded.value = false;
  emitToParent("commit:collapsed");
}

const {
  onDiffFileClick,
  copySelectedCommitHash,
  selectedCommitFullMessage,
  loadSelectedCommitFullMessage,
} = useDiffFileActions({
  selectedCommit: selectedCommitForFiles,
});

watch(commitDetailExpanded, (expanded) => {
  if (expanded) loadSelectedCommitFullMessage();
});

async function reloadHistory() {
  await loadHistory();
}

onMounted(() => {
  loadHistory();
});

function hasSelectedCommitFiles() {
  return !!selectedCommitForFiles.value;
}

defineExpose({
  reload: reloadHistory,
  load: loadHistory,
  closeExpanded: closeSelectedCommitFiles,
  hasExpanded: hasSelectedCommitFiles,
});
</script>

<style scoped>

.diff-files-selected-commit {
  flex-shrink: 0;
  flex-wrap: wrap;
  background: rgba(130, 170, 255, 0.06);
  border-bottom: 1px solid var(--border);
}

.diff-files-close-btn {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 18px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  min-width: 32px;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .diff-files-close-btn:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }
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

@media (hover: hover) and (pointer: fine) {
  .git-log-commit:not(.git-log-graph-only):hover {
    background: var(--bg-tertiary);
    cursor: pointer;
  }
}

.git-log-entry-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.git-log-entry-msg-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.git-log-entry-msg {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #fff;
  user-select: none;
  -webkit-user-select: none;
}

.git-log-entry-msg-toggle {
  cursor: pointer;
  border-radius: var(--radius);
}

@media (hover: hover) and (pointer: fine) {
  .git-log-entry-msg-toggle:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.05));
  }
}

.git-log-entry-msg-expanded {
  white-space: pre-wrap;
  overflow: visible;
  text-overflow: unset;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
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
  /* overflow:hidden は子の data-tooltip ::after をクリップするため visible。
     ref ラベル自体は .git-ref の max-width で個別に絞っているので暴走しない。 */
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

/* upstreamにはあるがまだpullしていないコミット（unpulled-log由来）。
   まだローカル履歴の一部ではないことを示す非アクティブ表示。 */
.git-log-entry-pending {
  opacity: 0.55;
}

/* まだupstreamにpushされていないローカルコミット（ahead件数分）。
   pendingと違い履歴自体は確定しているためグラフは通常表示のまま、
   テキストのみ非アクティブ色にして「未push」を示す。 */
.git-log-entry-unpushed .git-log-entry-msg,
.git-log-entry-unpushed .git-log-entry-author,
.git-log-entry-unpushed .git-log-entry-time {
  color: var(--text-muted);
}

</style>
