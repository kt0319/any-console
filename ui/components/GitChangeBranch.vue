<template>
  <div class="git-branch-pane-wrapper">
    <div v-if="addModalOpen" class="branch-add-overlay" @click.self="closeAddModal">
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
          @keydown.esc.prevent="closeAddModal"
        />
        <div class="branch-add-dialog-buttons">
          <button class="prompt-btn prompt-btn-cancel" @click="closeAddModal">Cancel</button>
          <button class="prompt-btn prompt-btn-ok" :disabled="!addName.trim()" @click="submitAddModal">Create</button>
        </div>
      </div>
    </div>
    <div class="modal-scroll-body" ref="branchListEl" :class="{ 'is-fetching': isBusy }">
        <div
          v-for="branch in otherLocalBranches"
          :key="'local-' + branch.name"
          class="branch-item"
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
            <span v-if="branch.isDefault" class="branch-default-badge" data-tooltip="Repository's default branch">default</span>
          </div>
          <div class="branch-item-actions" @click.stop>
            <GitActionBtn
              v-if="canPull(branch)"
              icon="pull"
              title="Switch to this branch to pull"
              :count="branch.behind || null"
              disabled
              :running="isRunning(workspaceStore.selectedWorkspace, 'pull')"
              btn-class="pull-btn has-count"
              @action="pullBranch(branch)"
            />
            <GitActionBtn
              v-if="canPush(branch)"
              icon="push"
              title="Push"
              :count="branch.ahead || null"
              :running="isPushing(branch)"
              btn-class="push-btn has-count"
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
              v-if="!worktreeByBranch[branch.name]"
              type="button"
              class="commit-action-item commit-action-danger branch-delete-btn"
              aria-label="Delete branch"
              data-tooltip="Delete branch"
              @click="deleteBranch(branch)"
            ><span class="mdi mdi-trash-can-outline"></span></button>
          </div>
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
                class="commit-action-item commit-action-danger branch-delete-btn"
                aria-label="Delete branch"
                data-tooltip="Delete branch"
                @click="deleteBranch(branch)"
              ><span class="mdi mdi-trash-can-outline"></span></button>
            </div>
          </div>
          <div v-if="remoteBranches.length === 0" class="branch-item-empty">No additional remote branches</div>
        </template>
    </div>
    <div class="branch-footer">
      <button type="button" class="branch-footer-btn" aria-label="Add" data-tooltip="Add branch or worktree" :disabled="isBusy" @click="openAddModal">
        <span class="mdi mdi-plus"></span> Add
      </button>
      <button type="button" class="branch-footer-btn" aria-label="Fetch" data-tooltip="Fetch remote branches" :disabled="isBusy" @click="fetchRemote">
        <span class="mdi" :class="isFetchingRemote ? 'mdi-refresh branch-toolbar-spin' : 'mdi-refresh'"></span> Fetch
      </button>
      <button type="button" class="branch-footer-btn" aria-label="Close" data-tooltip="Close branch list" @click="branchEmit('close')">
        <span class="mdi mdi-chevron-up"></span> Close
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useBranchList } from "../composables/useBranchList.js";
import { useBranchActions } from "../composables/useBranchActions.js";
import { useBranchAddDialog } from "../composables/useBranchAddDialog.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import GitActionBtn from "./GitActionBtn.vue";
import { canPull, canPush } from "../utils/git-branch.js";
import { emit } from "../app-bridge.js";

const branchEmit = defineEmits(["count", "close"]);

const workspaceStore = useWorkspaceStore();

const branchList = useBranchList();
const {
  localBranches,
  remoteBranches,
  remoteLoaded,
  isSwitchingBranch,
  worktreeByBranch,
  branches,
  linkedWorktree,
  loadBranchList,
} = branchList;

const {
  isFetchingRemote,
  isRunning,
  isPushing,
  createBranch,
  createWorktree,
  removeWorktree,
  pushBranch,
  pullBranch,
  deleteBranch,
  backgroundFetch,
  fetchRemote,
} = useBranchActions(branchList);

const isBusy = computed(() => isFetchingRemote.value || isSwitchingBranch.value);
const branchListEl = ref(null);

// 現在ブランチのPush/Pullは折り畳みヘッダー（WorkspaceDetail.vue）側に
// 出すため、一覧には現在ブランチ以外だけを並べる。
const otherLocalBranches = computed(() => localBranches.value.filter((b) => !b.current));

const {
  addModalOpen,
  addType,
  addName,
  openAddModal,
  closeAddModal,
  submitAddModal,
} = useBranchAddDialog({ createBranch, createWorktree });

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

.branch-footer {
  display: flex;
  justify-content: space-between;
  padding: 6px 8px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.branch-footer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}

.branch-footer-btn:disabled {
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
  .branch-footer-btn:not(:disabled):hover {
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

.branch-default-badge {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  vertical-align: middle;
}

.branch-item.remote-only {
  color: var(--text-muted);
}

.branch-item-action {
  color: var(--text-muted);
  font-style: italic;
}

.modal-scroll-body.is-fetching {
  pointer-events: none;
  opacity: 0.6;
}

.branch-delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  padding: 0;
  font-size: 15px;
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
