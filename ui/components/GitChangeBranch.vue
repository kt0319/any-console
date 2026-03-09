<template>
  <div class="git-branch-pane-wrapper">
    <div class="modal-scroll-body" ref="listEl">
      <div v-if="loading" style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>
      <template v-else>
        <div
          v-for="branch in branches"
          :key="branch.name"
          :class="['branch-item', { current: branch.current, 'remote-only': branch.remote }]"
          @click="selectBranch(branch)"
        >
          <div class="branch-item-name">
            {{ branch.name }}
            <span v-if="branch.current"> ✓</span>
          </div>
          <div v-if="!branch.current" class="branch-item-actions" @click.stop>
            <button
              type="button"
              class="commit-action-item commit-action-danger"
              @click="deleteBranch(branch)"
            >削除</button>
          </div>
        </div>
        <div
          v-if="!remoteExpanded && !loading"
          class="branch-item branch-item-action"
          @click="showRemoteBranches"
        >リモートブランチを表示...</div>
      </template>
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

const branches = ref([]);
const loading = ref(false);
const remoteExpanded = ref(false);
const listEl = ref(null);

async function load() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  loading.value = true;
  remoteExpanded.value = false;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/branches`);
    if (!res || !res.ok) { loading.value = false; return; }
    const data = await res.json();
    branches.value = (data || []).map((b) => ({
      name: b.name || b,
      current: !!b.current,
      remote: false,
    }));
  } catch (e) {
    console.error("branch load failed:", e);
  } finally {
    loading.value = false;
  }
}

async function showRemoteBranches() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  remoteExpanded.value = true;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/branches/remote`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const localNames = new Set(branches.value.map((b) => b.name));
    const remoteBranches = (data || [])
      .filter((b) => !localNames.has(b.name || b))
      .map((b) => ({ name: b.name || b, current: false, remote: true }));
    branches.value = [...branches.value, ...remoteBranches];
  } catch (e) {
    console.error("remote branch load failed:", e);
  }
}

function selectBranch(branch) {
  if (branch.current) return;
  emit("git:checkoutBranch", { branch: branch.name, remote: branch.remote });
}

async function deleteBranch(branch) {
  emit("git:deleteBranch", { branch: branch.name, remote: branch.remote });
}

async function backgroundFetch() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  try {
    await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/fetch`, { method: "POST" });
  } catch (e) {
    console.error("background fetch failed:", e);
  }
}

defineExpose({ load, backgroundFetch });
</script>
