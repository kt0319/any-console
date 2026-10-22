<template>
  <div class="git-changes-pane-wrapper pane-fill">
    <div class="diff-file-list">
      <div v-if="isLoading" class="text-muted-center loading-dots">Loading</div>
      <div v-else-if="loadError" class="text-muted-center">{{ loadError }}</div>
      <div v-else-if="files.length === 0" class="text-muted-center">No changes</div>
      <DiffFileBoxList v-else :key="listedWorkspace" :files="files" :diffChunks="diffChunks" :newFileContents="newFileContents" @navigate="selectFile" />
    </div>
    <GitCommitForm ref="commitForm" />
    <div v-if="actionButtons.length" class="diff-actions">
      <button
        v-for="action in actionButtons"
        :key="action.label"
        type="button"
        :class="action.class || ''"
        :disabled="action.loading || action.disabled?.()"
        @click="action.handler"
      >
        <span v-if="action.loading" class="mdi mdi-loading spin"></span>
        <template v-else>{{ action.label }}</template>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import DiffFileBoxList from "./DiffFileBoxList.vue";
import GitCommitForm from "./GitCommitForm.vue";
import { emit } from "../app-bridge.ts";
import { useGitDiff } from "../composables/useGitDiff.ts";
import { useGitWorkspaceActions } from "../composables/useGitWorkspaceActions.ts";
import { useWorkspace } from "../composables/useWorkspace.ts";
import { type AsyncState, asyncError, asyncLoading, asyncReady, asyncValueOr, isAsyncPending } from "../utils/async-state.ts";

const { fetchWorkingTreeDiff, fetchCommitDiff } = useGitDiff();
const { getWorkspace } = useWorkspace();
const { stashSave } = useGitWorkspaceActions();

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
  loading?: boolean;
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
const commitForm = ref<InstanceType<typeof GitCommitForm> | null>(null);

const isCommitDisabled = computed(
  // defineExpose された ref はテンプレート ref 経由では自動アンラップされる（.value を付けると常に undefined）
  () => !commitForm.value?.commitMessage?.trim() || !!commitForm.value?.submitting,
);
const isStashDisabled = computed(() => files.value.length === 0);

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
  const stashBtn = {
    label: "Stash",
    loading: false,
    disabled: () => isStashDisabled.value,
    handler: async () => {
      const workspace = getWorkspace();
      if (!workspace) return;
      stashBtn.loading = true;
      try {
        if (await stashSave(workspace)) await loadWorkingTreeDiff();
      } finally {
        stashBtn.loading = false;
      }
    },
  };
  actionButtons.value = [
    { label: "Commit", class: "primary", disabled: () => isCommitDisabled.value, handler: () => commitForm.value?.submit() },
    stashBtn,
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

.diff-actions {
  display: flex;
  gap: 6px;
  padding: 6px 10px;
  flex-shrink: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.diff-actions button {
  font-size: 13px;
  padding: 7px 14px;
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
