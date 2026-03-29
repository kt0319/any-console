<template>
  <div class="git-branch-pane-wrapper">
    <div class="modal-scroll-body" ref="branchListEl">
      <div v-if="isBranchListLoading" class="text-muted-center">Loading...</div>
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
            >Delete</button>
          </div>
        </div>
        <div
          v-if="!isRemoteBranchListExpanded && !isBranchListLoading"
          class="branch-item branch-item-action"
          @click="showRemoteBranches"
        >{{ isRemoteBranchListLoading ? 'Loading...' : 'Show remote branches...' }}</div>
      </template>
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

const branches = ref([]);
const isBranchListLoading = ref(false);
const isRemoteBranchListExpanded = ref(false);
const isRemoteBranchListLoading = ref(false);
const branchListEl = ref(null);

async function loadBranchList() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  isBranchListLoading.value = true;
  isRemoteBranchListExpanded.value = false;
  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, "branches"));
    if (!ok) { isBranchListLoading.value = false; return; }
    branches.value = (data || []).map((b) => ({
      name: b.name || b,
      current: !!b.current,
      remote: false,
    }));
  } catch (e) {
    console.error("branch load failed:", e);
  } finally {
    isBranchListLoading.value = false;
  }
}

async function showRemoteBranches() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace || isRemoteBranchListLoading.value) return;
  isRemoteBranchListLoading.value = true;
  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, "branches/remote"));
    if (!ok) return;
    const localNames = new Set(branches.value.map((b) => b.name));
    const remoteBranches = (data || [])
      .filter((b) => !localNames.has(b.name || b))
      .map((b) => ({ name: b.name || b, current: false, remote: true }));
    branches.value = [...branches.value, ...remoteBranches];
    isRemoteBranchListExpanded.value = true;
  } catch (e) {
    console.error("remote branch load failed:", e);
  } finally {
    isRemoteBranchListLoading.value = false;
  }
}

function selectBranch(branch) {
  if (branch.current) return;
  emit("git:checkoutBranch", { branch: branch.name, remote: branch.remote });
}

async function deleteBranch(branch) {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  const label = branch.remote ? `Remote branch ${branch.name}` : `Branch ${branch.name}`;
  if (!confirm(`Delete ${label}?`)) return;
  const { ok } = await apiCommand(wsEndpoint(workspace, "delete-branch"), { branch: branch.name, remote: branch.remote });
  if (!ok) return;
  await loadBranchList();
  emit("git:commitDone");
}

async function backgroundFetch() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;
  try {
    await apiCommand(wsEndpoint(workspace, "fetch"));
  } catch (e) {
    console.error("background fetch failed:", e);
  }
}

defineExpose({ load: loadBranchList, backgroundFetch });
</script>

<style scoped>
.git-branch-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.branch-item {
  box-sizing: border-box;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: background 0.15s;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.branch-item:last-child {
  border-bottom: none;
}

.branch-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch-item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.branch-item.current {
  color: var(--accent);
  cursor: default;
}

.branch-item.remote-only {
  color: var(--text-muted);
}

.branch-item-action {
  color: var(--text-muted);
  font-style: italic;
}

</style>
