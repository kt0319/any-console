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
        <FileItem
          v-for="file in files"
          :key="file.path"
          class="diff-file-row"
          :selected="selectedFile === file.path"
          :label="file.path"
          :icon-html="fileIconHtml(file)"
          @click="selectFile(file)"
        >
          <template #right>
            <span v-if="file.numstat" class="diff-file-row-numstat" v-html="file.numstat"></span>
            <span :class="['diff-file-row-status', statusClass(file.status)]">{{ file.status }}</span>
          </template>
        </FileItem>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import FileItem from "./FileItem.vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitStore, parseDiffChunks } from "../stores/git.js";
import { emit } from "../app-bridge.js";
import { renderFileIconFromPath } from "../utils/file-icon.js";
import { GIT_DIFF_STATUS_CLASSES } from "../utils/constants.js";
import { buildNumstatHtml, parseDiffNumstatFromChunk, resolveUntrackedNumstat } from "../utils/git.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const gitStore = useGitStore();

const files = ref([]);
const loading = ref(false);
const selectedFile = ref("");
const actionButtons = ref([]);

function statusClass(status) {
  return GIT_DIFF_STATUS_CLASSES[status] || "";
}

function fileIconHtml(file) {
  return renderFileIconFromPath(file.path);
}

function buildNumstatHtmlWithFallback(file, diffChunk = "", opts = {}) {
  const status = String(file.status || "").trim();
  const omitZeroDeletions = status === "??" || status === "A";
  const { neutralText = false } = opts;
  const insertions = file.insertions ?? file.added;
  const deletions = file.deletions ?? file.deleted;
  if (insertions != null || deletions != null) {
    return buildNumstatHtml(insertions, deletions, { omitZeroDeletions, neutralText });
  }
  const parsed = parseDiffNumstatFromChunk(diffChunk);
  return buildNumstatHtml(parsed?.insertions, parsed?.deletions, { omitZeroDeletions, neutralText });
}

async function loadWorkingTreeDiff() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  loading.value = true;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/diff`);
    if (!res || !res.ok) { loading.value = false; return; }
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
    files.value = fileList.map((f) => ({
      path: f.path,
      status: f.status,
      numstat: buildNumstatHtmlWithFallback(
        { ...f, insertions: f.insertions ?? untrackedNumstat[f.path], deletions: f.deletions ?? (untrackedNumstat[f.path] != null ? 0 : f.deletions) },
        diffChunks[f.path],
        { neutralText: untrackedNumstat[f.path] != null && f.insertions == null && f.deletions == null },
      ),
    }));
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
    const diffChunks = parseDiffChunks(data.diff);
    gitStore.diffChunks = diffChunks;
    gitStore.diffFullText = data.diff || "";
    files.value = (data.files || []).map((f) => ({
      path: f.path || f.name,
      status: f.status || "M",
      numstat: buildNumstatHtmlWithFallback(f, diffChunks[f.path || f.name]),
    }));
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
