<template>
  <div class="git-changes-pane-wrapper pane-fill">
    <div class="diff-top-bar">
      <div v-if="actionButtons.length" class="diff-actions">
        <button
          v-for="action in actionButtons"
          :key="action.label"
          type="button"
          :class="action.class || ''"
          :disabled="action.disabled?.()"
          @click="action.handler"
        >{{ action.label }}</button>
      </div>
      <div v-if="files.length" class="diff-bar-right">
        <span class="diff-total-numstat">
          <template v-for="part in summaryParts" :key="part.key"><span :class="part.className">{{ part.text }}</span>{{ " " }}</template>
          <span v-html="totalNumstat"></span>
        </span>
        <button
          type="button"
          class="diff-expand-btn hover-bg"
          :class="{ active: boxList?.allExpanded }"
          @click="boxList?.toggleAll()"
        >
          <span class="mdi" :class="boxList?.allExpanded ? 'mdi-unfold-less-horizontal' : 'mdi-unfold-more-horizontal'" aria-hidden="true"></span>
          <span class="diff-expand-label">
            <span v-for="label in toggleAllLabels" :key="label" :class="{ 'diff-expand-label-hidden': label !== toggleAllCurrentLabel }">{{ label }}</span>
          </span>
        </button>
      </div>
    </div>
    <div class="diff-file-list">
      <div v-if="isLoading" class="text-muted-center loading-dots">Loading</div>
      <div v-else-if="loadError" class="text-muted-center">{{ loadError }}</div>
      <div v-else-if="files.length === 0" class="text-muted-center">No changes</div>
      <DiffFileBoxList v-else ref="boxList" :key="listedWorkspace" :files="files" :diffChunks="diffChunks" :newFileContents="newFileContents" @navigate="selectFile" />
    </div>
    <GitCommitDialog ref="commitDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import DiffFileBoxList from "./DiffFileBoxList.vue";
import GitCommitDialog from "./GitCommitDialog.vue";
import { emit } from "../app-bridge.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { useGitDiff } from "../composables/useGitDiff.ts";
import { useGitWorkspaceActions } from "../composables/useGitWorkspaceActions.ts";
import { useWorkspace } from "../composables/useWorkspace.ts";
import { buildNumstatHtml, buildStatusCountItems, summarizeDiffFiles } from "../utils/git.ts";
import { type AsyncState, asyncError, asyncLoading, asyncReady, asyncValueOr, isAsyncPending } from "../utils/async-state.ts";

const { fetchWorkingTreeDiff, fetchCommitDiff } = useGitDiff();
const { getWorkspace } = useWorkspace();
const { stashSave } = useGitWorkspaceActions();
const { confirm } = useConfirm();

interface DiffFileRow {
  path: string;
  status: string;
  numstat?: string;
  insertions?: number;
  deletions?: number;
}

interface DiffActionButton {
  label: string;
  class?: string;
  disabled?: () => boolean;
  handler: () => void;
}

const diffState = ref<AsyncState<DiffFileRow[]>>(asyncLoading());
const files = computed(() => asyncValueOr(diffState.value, [] as DiffFileRow[]));
const isLoading = computed(() => isAsyncPending(diffState.value));
const loadError = computed(() => (diffState.value.status === "error" ? diffState.value.error : ""));
const diffChunks = ref<Record<string, string>>({});
const newFileContents = ref<Record<string, Record<string, any>>>({});
const listedWorkspace = ref("");
const isWorkingTree = ref(false);
const actionButtons = ref<DiffActionButton[]>([]);
const commitDialog = ref<InstanceType<typeof GitCommitDialog> | null>(null);
const boxList = ref<InstanceType<typeof DiffFileBoxList> | null>(null);

const hasNoChanges = computed(() => files.value.length === 0);
const summary = computed(() => summarizeDiffFiles(files.value));
const summaryParts = computed(() => buildStatusCountItems(summary.value.statusCounts).map(({ label, count, className }) => ({
  key: label, text: `${count}${label}`, className: ["diff-status-count", className],
})));
const toggleAllLabels = ["Expand all", "Collapse all"];
const toggleAllCurrentLabel = computed(() => (boxList.value?.allExpanded ? "Collapse all" : "Expand all"));
const totalNumstat = computed(() => buildNumstatHtml(summary.value.insertions, summary.value.deletions));

async function confirmAndStash() {
  const workspace = getWorkspace();
  if (!workspace) return;
  const count = files.value.length;
  await confirm(`Stash ${count} changed ${count === 1 ? "file" : "files"}, including untracked files? The working tree will be reverted.`, {
    ok: { label: "Stash" },
    busyLabel: "Stashing...",
    run: async () => {
      if (await stashSave(workspace)) await loadWorkingTreeDiff();
    },
  });
}

function selectFile(file: DiffFileRow) {
  emit("git:selectDiffFile", { path: file.path, isWorkingTree: isWorkingTree.value });
}

async function loadWorkingTreeDiff() {
  const workspace = getWorkspace();
  if (!workspace) {
    diffState.value = asyncError("No workspace selected");
    return;
  }
  const isRefreshingShownList = isWorkingTree.value && listedWorkspace.value === workspace && diffState.value.status === "ready";
  if (!isRefreshingShownList) diffState.value = asyncLoading();
  listedWorkspace.value = workspace;
  isWorkingTree.value = true;
  actionButtons.value = [
    { label: "Commit", class: "primary", disabled: () => hasNoChanges.value, handler: () => commitDialog.value?.open() },
    { label: "Stash", disabled: () => hasNoChanges.value, handler: confirmAndStash },
  ];
  try {
    const result = await fetchWorkingTreeDiff();
    if (!result) {
      diffState.value = asyncError("Failed to load changes");
      return;
    }
    diffChunks.value = result.diffChunks;
    newFileContents.value = result.newFileContents;
    diffState.value = asyncReady(result.fileList);
  } catch (e) {
    diffState.value = asyncError("Failed to load changes");
    console.error("diff load failed:", e);
  }
}

async function loadCommitDiff(hash: string) {
  diffState.value = asyncLoading();
  isWorkingTree.value = false;
  try {
    const result = await fetchCommitDiff(hash);
    if (!result) {
      // 元々エラー表示は無かった（filesが空のまま"No changes"扱い）が、
      // loadWorkingTreeDiff側と挙動を揃えて失敗を明示する。
      diffState.value = asyncError("Failed to load commit diff");
      return;
    }
    diffChunks.value = result.diffChunks;
    newFileContents.value = {};
    diffState.value = asyncReady(result.fileList);
    actionButtons.value = [];
  } catch (e) {
    diffState.value = asyncError("Failed to load commit diff");
    console.error("commit diff load failed:", e);
  }
}

defineExpose({ loadWorkingTreeDiff, loadCommitDiff });
</script>

<style scoped>

.diff-top-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  padding: 4px 10px;
  flex-shrink: 0;
}

.diff-bar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.diff-total-numstat {
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  display: inline-flex;
  gap: 4px;
}

.diff-expand-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  min-height: 0;
  padding: 0 8px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.diff-expand-label {
  display: grid;
}

.diff-expand-label > span {
  grid-area: 1 / 1;
  text-align: center;
}

.diff-expand-label-hidden {
  visibility: hidden;
}

.diff-expand-btn.active {
  background: var(--accent-bg-20);
  border-color: var(--accent);
  color: var(--accent);
}

.diff-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.diff-actions button {
  flex: 0 0 auto;
  width: auto;
  font-size: 13px;
  padding: 0 10px;
  height: 36px;
  min-height: 0;
}


.diff-file-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  flex: 1 1 auto;
  min-height: 0;
}


</style>
