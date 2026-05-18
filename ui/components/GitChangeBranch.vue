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
          <div class="branch-item-actions" @click.stop>
            <GitActionBtn
              v-if="canPush(branch)"
              :icon="branch.upstream ? 'push' : 'push-upstream'"
              title="Push"
              :count="branch.ahead || null"
              :running="isPushing(branch)"
              :btn-class="branch.upstream ? 'push-btn has-count' : 'upstream-btn'"
              @action="pushBranch(branch)"
            />
            <button
              v-if="!branch.current"
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
import { useApi } from "../composables/useApi.js";
import { useWorkspace } from "../composables/useWorkspace.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import GitActionBtn from "./GitActionBtn.vue";
import { emit } from "../app-bridge.js";

const { apiGet, apiCommand, wsEndpoint } = useApi();
const { withWorkspace } = useWorkspace();
const { confirm } = useConfirm();
const { gitAction, isRunning } = useGitRemoteAction();
const workspaceStore = useWorkspaceStore();

const branches = ref([]);
const isBranchListLoading = ref(false);
const isRemoteBranchListExpanded = ref(false);
const isRemoteBranchListLoading = ref(false);
const branchListEl = ref(null);

async function loadBranchList() {
  await withWorkspace(async (workspace) => {
    isBranchListLoading.value = true;
    isRemoteBranchListExpanded.value = false;
    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "branches"));
      if (!ok) return;
      branches.value = (data || []).map((b) => ({
        name: b.name || b,
        current: !!b.current,
        remote: false,
        ahead: Number(b.ahead) || 0,
        behind: Number(b.behind) || 0,
        upstream: b.upstream || null,
        gone: !!b.gone,
      }));
    } catch (e) {
      console.error("branch load failed:", e);
    } finally {
      isBranchListLoading.value = false;
    }
  });
}

async function showRemoteBranches() {
  if (isRemoteBranchListLoading.value) return;
  await withWorkspace(async (workspace) => {
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
  });
}

function selectBranch(branch) {
  if (branch.current) return;
  emit("git:checkoutBranch", { branch: branch.name, remote: branch.remote });
}

async function pushBranch(branch) {
  await withWorkspace(async (workspace) => {
    await gitAction(workspace, "push-branch", { branch: branch.name });
    await loadBranchList();
  });
}

function isPushing(branch) {
  return isRunning(workspaceStore.selectedWorkspace, "push-branch", branch.name);
}

function canPush(branch) {
  if (branch.remote) return false;
  if (!branch.upstream) return true;
  return branch.ahead > 0;
}

async function deleteBranch(branch) {
  await withWorkspace(async (workspace) => {
    const label = branch.remote ? `Remote branch ${branch.name}` : `Branch ${branch.name}`;
    if (!await confirm(`Delete ${label}?`)) return;
    const { ok } = await apiCommand(wsEndpoint(workspace, "delete-branch"), { branch: branch.name, remote: branch.remote });
    if (!ok) return;
    await loadBranchList();
    emit("git:commitDone");
  });
}

async function backgroundFetch() {
  await withWorkspace(async (workspace) => {
    try {
      await apiCommand(wsEndpoint(workspace, "fetch"));
    } catch (e) {
      console.error("background fetch failed:", e);
    }
  });
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
