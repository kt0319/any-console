<template>
  <div class="git-branch-pane-wrapper">
    <div class="branch-toolbar">
      <span class="branch-toolbar-spacer"></span>
      <button type="button" class="branch-toolbar-btn" aria-label="Fetch" data-tooltip="Fetch" :disabled="isBusy" @click="fetchRemote">
        <span class="mdi" :class="isFetchingRemote ? 'mdi-refresh branch-toolbar-spin' : 'mdi-refresh'"></span>
      </button>
      <button type="button" class="branch-toolbar-btn" aria-label="Add" data-tooltip="Add" :disabled="isBusy" @click="openAddModal">
        <span class="mdi mdi-plus"></span>
      </button>
    </div>

    <div v-if="addModalOpen" class="branch-add-overlay" @click.self="addModalOpen = false">
      <div class="branch-add-dialog" role="dialog" aria-modal="true" aria-label="Add Branch or Worktree">
        <div class="branch-add-dialog-title">Add</div>
        <div class="branch-add-radio-group">
          <label class="branch-add-radio-label">
            <input type="radio" v-model="addType" value="branch" />
            <span class="mdi mdi-source-branch"></span> Branch
          </label>
          <p class="branch-add-dialog-desc">Creates a branch from the current commit.</p>
          <label class="branch-add-radio-label">
            <input type="radio" v-model="addType" value="worktree" />
            <span class="mdi mdi-file-tree"></span> Worktree
          </label>
          <p class="branch-add-dialog-desc">Creates a worktree on a new branch. Enables parallel work in a separate directory.</p>
        </div>
        <input
          v-model="addName"
          class="form-input"
          type="text"
          placeholder="feature/example"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          @keydown.enter.prevent="submitAddModal"
          @keydown.esc.prevent="addModalOpen = false"
        />
        <div class="branch-add-dialog-buttons">
          <button class="prompt-btn prompt-btn-cancel" @click="addModalOpen = false">Cancel</button>
          <button class="prompt-btn prompt-btn-ok" :disabled="!addName.trim()" @click="submitAddModal">Create</button>
        </div>
      </div>
    </div>
    <div class="modal-scroll-body" ref="branchListEl" :class="{ 'is-fetching': isBusy }">
      <div class="branch-section-header">
        <span>LOCAL</span>
      </div>
        <div
          v-for="branch in localBranches"
          :key="'local-' + branch.name"
          :class="['branch-item', { current: branch.current }]"
          @click="selectBranch(branch)"
        >
          <div class="branch-item-name">
            <span
              v-if="linkedWorktree(branch)"
              class="mdi mdi-file-tree branch-worktree-icon"
              aria-label="Has worktree"
              data-tooltip="Has worktree"
            ></span>
            {{ branch.name }}
            <span v-if="branch.current"> ✓</span>
          </div>
          <div class="branch-item-actions" @click.stop>
            <GitActionBtn
              v-if="canPull(branch)"
              icon="pull"
              :title="branch.current ? 'Pull' : 'Switch to this branch to pull'"
              :count="branch.behind || null"
              :disabled="!branch.current"
              :running="isRunning(workspaceStore.selectedWorkspace, 'pull')"
              :btn-class="'pull-btn has-count'"
              @action="pullBranch(branch)"
            />
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
              v-if="linkedWorktree(branch)"
              type="button"
              class="commit-action-item commit-action-danger"
              title="Remove worktree"
              @click="removeWorktree(linkedWorktree(branch))"
            >Remove WT</button>
            <button
              v-if="!branch.current && !worktreeByBranch[branch.name]"
              type="button"
              class="commit-action-item commit-action-danger"
              @click="deleteBranch(branch)"
            >Delete</button>
          </div>
        </div>
        <div
          class="branch-section-header branch-section-header-toggle"
          :class="{ 'is-busy': isBusy }"
          @click="fetchRemote"
        >
          <span>REMOTE</span>
          <span v-if="isFetchingRemote" class="branch-section-loading">Loading...</span>
        </div>
        <template v-if="remoteLoaded">
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
        <div v-else-if="!isRemoteBranchListLoading" class="branch-item-empty">Tap REMOTE to fetch from origin</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useWorkspace } from "../composables/useWorkspace.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useToast } from "../composables/useToast.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import GitActionBtn from "./GitActionBtn.vue";
import { worktreeBranchLabel } from "../utils/worktree.js";
import { emit } from "../app-bridge.js";

const branchEmit = defineEmits(["count"]);

// ワークスペースごとのリモートブランチキャッシュ（タブ再表示時に即復元）
const _remoteCache = new Map();

const { apiGet, apiCommand, apiDelete, wsEndpoint } = useApi();
const { withWorkspace } = useWorkspace();
const { confirm } = useConfirm();
const toast = useToast();
const { gitAction, isRunning } = useGitRemoteAction();
const workspaceStore = useWorkspaceStore();

const addModalOpen = ref(false);
const addType = ref("branch");
const addName = ref("");

function openAddModal() {
  addName.value = "";
  addType.value = "branch";
  addModalOpen.value = true;
}

async function submitAddModal() {
  const name = addName.value.trim();
  if (!name) return;
  addModalOpen.value = false;
  if (addType.value === "worktree") {
    await doCreateWorktree(name);
  } else {
    await withWorkspace(async (workspace) => {
      const { ok } = await apiCommand(wsEndpoint(workspace, "create-branch"), { branch: name });
      if (!ok) return;
      await loadBranchList();
      emit("git:commitDone");
    });
  }
}

const localBranches = ref([]);
const worktrees = ref([]);

const worktreeByBranch = computed(() => {
  const map = {};
  for (const wt of worktrees.value) {
    if (wt.branch) map[wt.branch] = wt;
  }
  return map;
});

function linkedWorktree(branch) {
  const wt = worktreeByBranch.value[branch.name];
  return wt && !wt.is_main ? wt : null;
}
const remoteBranches = ref([]);
const remoteLoaded = ref(false);
const isBranchListLoading = ref(false);
const isRemoteBranchListLoading = ref(false);
const isFetchingRemote = ref(false);
const isSwitchingBranch = ref(false);
const isBusy = computed(() => isFetchingRemote.value || isSwitchingBranch.value);
const branchListEl = ref(null);

const branches = computed(() => [...localBranches.value, ...remoteBranches.value]);

async function loadBranchList() {
  isSwitchingBranch.value = false;
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
      const cached = _remoteCache.get(workspace);
      if (cached) {
        remoteBranches.value = cached;
        remoteLoaded.value = true;
      } else {
        remoteBranches.value = [];
        remoteLoaded.value = false;
      }
    } catch (e) {
      console.error("branch load failed:", e);
    } finally {
      isBranchListLoading.value = false;
    }
  });
  await loadWorktrees();
}

async function loadWorktrees() {
  await withWorkspace(async (workspace) => {
    const { ok, data } = await apiGet(wsEndpoint(workspace, "worktrees"));
    if (!ok) return;
    worktrees.value = data?.worktrees || [];
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
      const filtered = (data || [])
        .filter((b) => !localNames.has(b.name || b))
        .map((b) => ({ name: b.name || b, current: false, remote: true }));
      remoteBranches.value = filtered;
      remoteLoaded.value = true;
      _remoteCache.set(workspace, filtered);
    } catch (e) {
      console.error("remote branch load failed:", e);
    } finally {
      isRemoteBranchListLoading.value = false;
    }
  });
}

function selectBranch(branch) {
  if (branch.current) return;
  const wt = linkedWorktree(branch);
  if (wt && wt.workspace) {
    openWorktree(wt);
    return;
  }
  isSwitchingBranch.value = true;
  emit("git:checkoutBranch", { branch: branch.name, remote: branch.remote });
}

function switchToWorkspace(name) {
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === name);
  emit("modal:close");
  emit("terminal:launch", { workspace: name, icon: ws?.icon, iconColor: ws?.icon_color });
}

function openWorktree(wt) {
  if (wt?.workspace) switchToWorkspace(wt.workspace);
}

async function doCreateWorktree(branchName) {
  await withWorkspace(async (workspace) => {
    const { ok, data } = await apiCommand(
      wsEndpoint(workspace, "worktrees"),
      { branch: branchName },
      { errorMessage: "Failed to create worktree" },
    );
    if (!ok) return;
    const created = data?.workspace;
    await workspaceStore.fetchWorkspaces();
    await loadBranchList();
    if (created?.name) {
      toast.success(`Worktree ${worktreeBranchLabel(created.branch)} created`);
      emit("worktree:open", { name: created.name, pane: "jobs" });
    }
  });
}

async function removeWorktree(wt) {
  await withWorkspace(async (workspace) => {
    if (!await confirm(`Remove worktree "${wt.branch || wt.path}"? The working tree directory will be deleted. This cannot be undone.`)) return;
    const { ok } = await apiDelete(
      wsEndpoint(workspace, "worktrees"),
      { body: { path: wt.path }, checkStatus: true, errorMessage: "Failed to remove worktree" },
    );
    if (!ok) return;
    await workspaceStore.fetchWorkspaces();
    await loadWorktrees();
    toast.success(`Worktree removed: ${workspace} [${wt.branch || wt.path}]`);
  });
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

function canPull(branch) {
  return !branch.remote && !!branch.upstream && branch.behind > 0;
}

function canPush(branch) {
  if (branch.remote) return false;
  if (!branch.upstream) return true;
  return branch.ahead > 0;
}

async function pullBranch(branch) {
  if (!branch.current) {
    emit("toast:show", { message: `Switch to "${branch.name}" to pull`, type: "info" });
    return;
  }
  await withWorkspace(async (workspace) => {
    await gitAction(workspace, "pull");
    await loadBranchList();
  });
}

async function deleteBranch(branch) {
  await withWorkspace(async (workspace) => {
    const label = branch.remote ? `Remote branch ${branch.name}` : `Branch ${branch.name}`;
    if (!await confirm(`Delete ${label}?`)) return;
    const { ok } = await apiCommand(wsEndpoint(workspace, "delete-branch"), { branch: branch.name, remote: branch.remote });
    if (!ok) return;
    if (branch.remote) _remoteCache.delete(workspace);
    await loadBranchList();
    emit("git:commitDone");
    await fetchRemote();
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

async function fetchRemote() {
  if (isFetchingRemote.value) return;
  isFetchingRemote.value = true;
  try {
    await withWorkspace(async (workspace) => {
      const { ok } = await apiCommand(wsEndpoint(workspace, "fetch"), {}, {
        errorMessage: "Fetch failed",
      });
      if (!ok) return;
      remoteLoaded.value = false;
      await loadBranchList();
      await loadRemoteBranches();
      emit("toast:show", { message: "Fetched remote", type: "success" });
    });
  } finally {
    isFetchingRemote.value = false;
  }
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

.branch-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.branch-toolbar-spacer {
  flex: 1;
}

.branch-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.branch-toolbar-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.branch-toolbar-spin {
  animation: branch-spinner-spin 0.8s linear infinite;
}

.branch-add-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
  padding: 20px;
}

.branch-add-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  width: min(360px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.branch-add-dialog-title {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.branch-add-dialog-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 2px 0 0 24px;
}

.branch-add-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.branch-add-radio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.branch-add-radio-label input[type="radio"] {
  accent-color: var(--accent);
}

.branch-add-dialog-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

@media (hover: hover) and (pointer: fine) {
  .branch-toolbar-btn:not(:disabled):hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
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
  box-sizing: border-box;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-tertiary) 60%, transparent);
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
}

.branch-section-header-toggle {
  width: 100%;
  border-top: 1px solid var(--border);
  cursor: pointer;
}

.branch-section-header-toggle.is-busy {
  pointer-events: none;
  opacity: 0.7;
}

.modal-scroll-body.is-fetching {
  pointer-events: none;
  opacity: 0.6;
}

.branch-section-loading {
  margin-left: auto;
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--text-muted);
}

.branch-worktree-icon {
  font-size: 13px;
  margin-right: 4px;
  color: var(--accent);
}

.branch-worktree-icon.is-main {
  color: var(--text-muted);
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
