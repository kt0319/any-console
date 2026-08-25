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
        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-cancel" @click="closeAddModal">Cancel</button>
          <button class="dialog-btn dialog-btn-ok" :disabled="!addName.trim()" @click="submitAddModal">Create</button>
        </div>
      </div>
    </div>
    <div class="modal-scroll-body" ref="branchListEl" :class="{ 'is-fetching': isBusy }">
        <div
          v-for="branch in localBranches"
          :key="'local-' + branch.name"
          v-show="branch.current || expanded"
          :class="['branch-item', { current: branch.current, 'branch-item-no-border': branch.current && !expanded }]"
          :aria-expanded="branch.current ? expanded : undefined"
          @click="onRowClick(branch)"
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
              class="commit-action-item commit-action-danger branch-delete-btn"
              aria-label="Remove worktree"
              data-tooltip="Remove worktree"
              @click="removeWorktree(linkedWorktree(branch)!)"
            ><span class="mdi mdi-trash-can-outline"></span></button>
            <button
              v-if="!branch.current && !worktreeByBranch[branch.name]"
              type="button"
              class="commit-action-item commit-action-danger branch-delete-btn"
              aria-label="Delete branch"
              data-tooltip="Delete branch"
              @click="deleteBranch(branch)"
            ><span class="mdi mdi-trash-can-outline"></span></button>
          </div>
          <span
            v-if="branch.current"
            class="mdi branch-summary-caret"
            :class="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
            aria-hidden="true"
          ></span>
        </div>
        <div v-if="remoteLoaded" v-show="expanded">
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
        </div>
        <div v-show="expanded" class="branch-summary-toolbar">
          <button
            type="button"
            class="branch-summary-add-btn hover-bg-text"
            aria-label="Add branch or worktree"
            data-tooltip="Add branch or worktree"
            @click="openAddModal"
          ><span class="mdi mdi-plus"></span> Add</button>
          <button
            type="button"
            class="branch-summary-fetch-btn hover-bg-text"
            aria-label="Fetch"
            data-tooltip="Fetch remote branches"
            @click="fetchRemote"
          ><span class="mdi mdi-refresh"></span> Fetch</button>
        </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useBranchList } from "../composables/useBranchList.ts";
import { useBranchActions } from "../composables/useBranchActions.ts";
import { useBranchAddDialog } from "../composables/useBranchAddDialog.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import GitActionBtn from "./GitActionBtn.vue";
import { canPull, canPush, type LocalBranch, type RemoteBranch } from "../utils/git-branch.ts";
import { worktreeWorkspaceName } from "../utils/worktree.ts";
import { emit } from "../app-bridge.ts";

defineProps({
  expanded: { type: Boolean, default: false },
});
const branchEmit = defineEmits(["count", "toggle"]);

const workspaceStore = useWorkspaceStore();
const { confirm } = useConfirm();

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
const branchListEl = ref<HTMLElement | null>(null);

const {
  addModalOpen,
  addType,
  addName,
  openAddModal,
  closeAddModal,
  submitAddModal,
} = useBranchAddDialog({ createBranch, createWorktree });

// 現在ブランチの行はセレクトボックスの先頭項目 兼 開閉トグルを兼ねる
// （selectBranchは現在ブランチをクリックしても元々no-opだったため、
// そのクリックをtoggleに転用しても既存挙動と衝突しない）。
function onRowClick(branch: LocalBranch | RemoteBranch) {
  if (branch.current) {
    branchEmit("toggle");
    return;
  }
  selectBranch(branch);
}

async function selectBranch(branch: LocalBranch | RemoteBranch) {
  if (branch.current) return;
  const wt = linkedWorktree(branch);
  if (wt) {
    if (!await confirm(`Open worktree "${branch.name}"? This opens a new tab.`)) return;
    openWorktree(wt);
    return;
  }
  isSwitchingBranch.value = true;
  emit("git:checkoutBranch", { branch: branch.name, remote: branch.remote });
}

function switchToWorkspace(name: string) {
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === name);
  emit("modal:close");
  emit("terminal:launch", { workspace: name, icon: ws?.icon, iconColor: ws?.icon_color });
}

function openWorktree(wt: Record<string, unknown>) {
  // /worktrees API由来のwtは、config.jsonに明示登録されたworktreeでしか
  // workspaceが埋まらない（useBranchActions.tsのremoveWorktreeと同じ理由）。
  // 未登録でも base+branch から動的worktreeワークスペース名を組み立てて開く。
  const wsName = (wt.workspace as string) || worktreeWorkspaceName(workspaceStore.selectedWorkspace, wt.branch as string);
  if (wsName) switchToWorkspace(wsName);
}

watch(branches, (list) => {
  branchEmit("count", list.filter((b) => !b.remote).length);
});

defineExpose({ load: loadBranchList, backgroundFetch, openAddModal, fetchRemote });
</script>

<style scoped>
.git-branch-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
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

/* 折りたたみ時はv-showで非表示の行がDOM上に残ったままのため:last-childが
   効かず、唯一表示される現在ブランチ行にborder-bottomが残ってしまう
   （外枠 .branch-summary-body の下枠と二重線に見える）。明示的に消す。 */
.branch-item.branch-item-no-border {
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
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  opacity: 0.75;
  vertical-align: middle;
}

/* 現在ブランチの行は一覧の先頭項目 兼 開閉トグル（クリックで展開/折りたたみ）。 */
.branch-item.current {
  color: var(--accent);
  cursor: pointer;
}

.branch-item.remote-only {
  color: var(--text-muted);
}

@media (hover: hover) and (pointer: fine) {
  .branch-item:hover {
    background: var(--accent-bg-12);
    color: var(--accent);
  }
}

.branch-summary-caret {
  margin-left: 8px;
  color: var(--text-muted);
  font-size: 16px;
  flex-shrink: 0;
}

/* Add/Fetchは展開時だけ表示するツールバー（トグル行のすぐ下）。 */
.branch-summary-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}

.branch-summary-add-btn,
.branch-summary-fetch-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 1;
  min-height: 32px;
  padding: 4px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
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


.branch-item-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-style: italic;
  font-size: 13px;
}

</style>
