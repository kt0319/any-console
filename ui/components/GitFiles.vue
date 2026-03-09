<template>
  <div class="git-files-pane-wrapper">
    <div v-if="actionButtons.length" class="diff-actions">
      <button
        v-for="action in actionButtons"
        :key="action.label"
        type="button"
        :class="action.class || ''"
        @click="action.handler"
      >{{ action.label }}</button>
    </div>
    <div class="diff-file-list">
      <div v-if="loading" style="color:var(--text-muted);padding:16px">読み込み中...</div>
      <ul v-else class="file-browser-list diff-file-browser-list">
        <li
          v-for="file in files"
          :key="file.path"
          class="file-browser-item diff-file-row"
          :class="{ selected: selectedFile === file.path }"
          @click="selectFile(file)"
        >
          <span class="file-browser-item-icon" v-html="fileIconHtml(file)"></span>
          <span class="file-browser-item-name">{{ file.path }}</span>
          <span v-if="file.numstat" class="diff-file-row-numstat" v-html="file.numstat"></span>
          <span :class="['diff-file-row-status', statusClass(file.status)]">{{ file.status }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore, parseDiffChunks } from "../stores/git.js";
import { emit } from "../app-bridge.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const files = ref([]);
const loading = ref(false);
const selectedFile = ref("");
const actionButtons = ref([]);

const STATUS_CLASSES = { M: "diff-status-mod", A: "diff-status-add", D: "diff-status-del", "?": "diff-status-untracked" };

function statusClass(status) {
  return STATUS_CLASSES[status] || "";
}

function fileIconHtml(file) {
  const status = file.status;
  if (status === "D") return '<span class="mdi mdi-file-remove" style="color:var(--diff-del)"></span>';
  if (status === "A" || status === "?") return '<span class="mdi mdi-file-plus" style="color:var(--diff-add)"></span>';
  return '<span class="mdi mdi-file-edit" style="color:var(--diff-hunk)"></span>';
}

async function loadWorkingTreeDiff() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  loading.value = true;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/diff`);
    if (!res || !res.ok) { loading.value = false; return; }
    const data = await res.json();
    files.value = (data.files || []).map((f) => ({
      path: f.path || f.name,
      status: f.status || "M",
      numstat: f.added != null ? `<span class="numstat-added">+${f.added}</span> <span class="numstat-deleted">-${f.deleted}</span>` : "",
    }));
    gitStore.diffChunks = parseDiffChunks(data.diff);
    gitStore.diffFullText = data.diff || "";
    actionButtons.value = [
      { label: "コミット", class: "primary", handler: () => emit("git:openCommitForm") },
      { label: "Stash", handler: () => emit("git:stashSave") },
    ];
  } catch (e) {
    console.error("diff load failed:", e);
  } finally {
    loading.value = false;
  }
}

async function loadCommitDiff(hash) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  loading.value = true;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/diff/${encodeURIComponent(hash)}`);
    if (!res || !res.ok) { loading.value = false; return; }
    const data = await res.json();
    files.value = (data.files || []).map((f) => ({
      path: f.path || f.name,
      status: f.status || "M",
      numstat: f.added != null ? `<span class="numstat-added">+${f.added}</span> <span class="numstat-deleted">-${f.deleted}</span>` : "",
    }));
    gitStore.diffChunks = parseDiffChunks(data.diff);
    gitStore.diffFullText = data.diff || "";
    actionButtons.value = [];
  } catch (e) {
    console.error("commit diff load failed:", e);
  } finally {
    loading.value = false;
  }
}

function selectFile(file) {
  selectedFile.value = file.path;
  emit("git:selectDiffFile", { path: file.path });
}

defineExpose({ loadWorkingTreeDiff, loadCommitDiff });
</script>
