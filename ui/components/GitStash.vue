<template>
  <div class="git-stash-pane-wrapper">
    <div class="stash-pane-toolbar">
      <button type="button" @click="stashSave">stash save</button>
    </div>
    <div class="modal-scroll-body" ref="listEl">
      <div v-if="loading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <div v-else-if="entries.length === 0" style="color:var(--text-muted);padding:16px;text-align:center">stashはありません</div>
      <div v-for="entry in entries" :key="entry.ref" class="stash-entry">
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
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();

const entries = ref([]);
const loading = ref(false);
const listEl = ref(null);

async function load() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  loading.value = true;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/stash-list`);
    if (!res || !res.ok) { loading.value = false; return; }
    const data = await res.json();
    entries.value = (data.entries || []).map((e) => ({
      ref: e.ref || e.stash_ref,
      message: e.message || "",
      time: e.time || "",
    }));
  } catch (e) {
    console.error("stash list load failed:", e);
  } finally {
    loading.value = false;
  }
}

async function stashSave() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/stash`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ include_untracked: true }),
  });
  if (!res || !res.ok) return;
  await load();
  emit("git:commitDone");
}

async function stashPop(entry) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/stash-pop-ref`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stash_ref: entry.ref }),
  });
  if (!res || !res.ok) return;
  await load();
  emit("git:commitDone");
}

async function stashDrop(entry) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/stash-drop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stash_ref: entry.ref }),
  });
  if (!res || !res.ok) return;
  await load();
}

defineExpose({ load });
</script>
