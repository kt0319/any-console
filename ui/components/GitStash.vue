<template>
  <div class="git-stash-pane-wrapper">
    <div class="stash-pane-toolbar">
      <button type="button" class="stash-save-btn" @click="stashSave">stash save</button>
    </div>
    <div class="modal-scroll-body" ref="stashListEl">
      <div v-if="isStashListLoading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <div v-else-if="stashEntries.length === 0" style="color:var(--text-muted);padding:16px;text-align:center">stashはありません</div>
      <div v-for="entry in stashEntries" :key="entry.ref" class="stash-entry">
        <div class="stash-entry-info">
          <span class="stash-entry-ref">{{ entry.ref }}</span>
          <span class="stash-entry-msg">{{ entry.message }}</span>
          <span v-if="entry.time" class="stash-entry-time">{{ entry.time }}</span>
        </div>
        <div class="stash-entry-actions">
          <button type="button" class="commit-action-item" @click="stashPop(entry)">適用</button>
          <button type="button" class="commit-action-item commit-action-danger" @click="stashDrop(entry)">削除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { emit } from "../app-bridge.js";

const { apiGet, apiCommand, wsEndpoint } = useApi();
const workspaceStore = useWorkspaceStore();

const stashEntries = ref([]);
const isStashListLoading = ref(false);
const stashListEl = ref(null);

async function loadStashList() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  isStashListLoading.value = true;
  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, "stash-list"));
    if (!ok) { isStashListLoading.value = false; return; }
    stashEntries.value = (data.entries || []).map((e) => ({
      ref: e.ref || e.stash_ref,
      message: e.message || "",
      time: e.time || "",
    }));
  } catch (e) {
    console.error("stash list load failed:", e);
  } finally {
    isStashListLoading.value = false;
  }
}

async function stashSave() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "stash"), { include_untracked: true });
  if (!ok) return;
  await loadStashList();
  emit("git:commitDone");
}

async function stashPop(entry) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "stash-pop-ref"), { stash_ref: entry.ref });
  if (!ok) return;
  await loadStashList();
  emit("git:commitDone");
}

async function stashDrop(entry) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "stash-drop"), { stash_ref: entry.ref });
  if (!ok) return;
  await loadStashList();
}

defineExpose({ load: loadStashList });
</script>

<style scoped>
.git-stash-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
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

.stash-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}

.stash-entry:last-child {
  border-bottom: none;
}

.stash-entry-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stash-entry-ref {
  color: var(--warning);
  font-weight: 600;
  font-size: 11px;
}

.stash-entry-msg {
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stash-entry-time {
  color: var(--text-muted);
  font-size: 11px;
}

.stash-entry-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

</style>
