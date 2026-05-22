<template>
  <div class="git-branch-pane-wrapper">
    <div class="modal-scroll-body" ref="branchListEl">
      <div class="branch-section-header">
        <span>LOCAL</span>
        <span class="branch-section-count">{{ localBranches.length }}</span>
      </div>
        <div
          v-for="branch in localBranches"
          :key="'local-' + branch.name"
          :class="['branch-item', { current: branch.current }]"
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
        <button
          type="button"
          class="branch-section-header branch-section-header-toggle"
          @click="toggleRemoteSection"
        >
          <span class="mdi" :class="isRemoteBranchListExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"></span>
          <span>REMOTE</span>
          <span v-if="isRemoteBranchListLoading" class="mdi mdi-loading branch-section-spinner"></span>
          <span v-else-if="isRemoteBranchListExpanded" class="branch-section-count">{{ remoteBranches.length }}</span>
        </button>
        <template v-if="isRemoteBranchListExpanded && !isRemoteBranchListLoading">
          <div
            v-for="branch in remoteBranches"
            :key="'remote-' + branch.name"
            class="branch-item remote-only"
            @click="selectBranch(branch)"
          >
            <div class="branch-item-name">{{ branch.name }}</div>
            <div class="branch-item-actions" @click.stop>
              <button
                type="button"
                class="commit-action-item commit-action-danger"
                @click="deleteBranch(branch)"
              >Delete</button>
            </div>
          </div>
          <div v-if="remoteBranches.length === 0" class="branch-item-empty">No additional remote branches</div>
        </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useApi } from "../composables/useApi.js";
import { useWorkspace } from "../composables/useWorkspace.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import GitActionBtn from "./GitActionBtn.vue";
import { emit } from "../app-bridge.js";

const branchEmit = defineEmits(["count"]);

const { apiGet, apiCommand, wsEndpoint } = useApi();
const { withWorkspace } = useWorkspace();
const { confirm } = useConfirm();
const { gitAction, isRunning } = useGitRemoteAction();
const workspaceStore = useWorkspaceStore();

const localBranches = ref([]);
const remoteBranches = ref([]);
const remoteLoaded = ref(false);
const isBranchListLoading = ref(false);
const isRemoteBranchListExpanded = ref(false);
const isRemoteBranchListLoading = ref(false);
const branchListEl = ref(null);

const branches = computed(() => [...localBranches.value, ...remoteBranches.value]);

async function loadBranchList() {
  await withWorkspace(async (workspace) => {
    isBranchListLoading.value = true;
    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "branches"));
      if (!ok) return;
      localBranches.value = (data || []).map((b) => ({
        name: b.name || b,
        current: !!b.current,
        remote: false,
        ahead: Number(b.ahead) || 0,
        behind: Number(b.behind) || 0,
        upstream: b.upstream || null,
        gone: !!b.gone,
      }));
      // ローカル更新時にリモート側もキャッシュ無効化
      remoteBranches.value = [];
      remoteLoaded.value = false;
      if (isRemoteBranchListExpanded.value) await loadRemoteBranches();
    } catch (e) {
      console.error("branch load failed:", e);
    } finally {
      isBranchListLoading.value = false;
    }
  });
}

async function loadRemoteBranches() {
  if (isRemoteBranchListLoading.value) return;
  await withWorkspace(async (workspace) => {
    isRemoteBranchListLoading.value = true;
    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "branches/remote"));
      if (!ok) return;
      const localNames = new Set(localBranches.value.map((b) => b.name));
      remoteBranches.value = (data || [])
        .filter((b) => !localNames.has(b.name || b))
        .map((b) => ({ name: b.name || b, current: false, remote: true }));
      remoteLoaded.value = true;
    } catch (e) {
      console.error("remote branch load failed:", e);
    } finally {
      isRemoteBranchListLoading.value = false;
    }
  });
}

async function toggleRemoteSection() {
  isRemoteBranchListExpanded.value = !isRemoteBranchListExpanded.value;
  if (isRemoteBranchListExpanded.value && !remoteLoaded.value) {
    await loadRemoteBranches();
  }
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

watch(branches, (list) => {
  branchEmit("count", list.filter((b) => !b.remote).length);
});

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

.branch-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  background: color-mix(in srgb, var(--bg-secondary) 50%, transparent);
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
}

.branch-section-header-toggle {
  width: 100%;
  border: none;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: color-mix(in srgb, var(--bg-secondary) 50%, transparent);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  text-align: left;
  margin: 0;
  box-shadow: none;
  min-height: 0;
}

.branch-section-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: normal;
  color: var(--text-muted);
}

.branch-section-spinner {
  font-size: 14px;
  animation: branch-spinner-spin 0.8s linear infinite;
}

@keyframes branch-spinner-spin {
  to { transform: rotate(360deg); }
}

.branch-item-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-style: italic;
  font-size: 13px;
}

</style>
