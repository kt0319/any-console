<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <!-- ツールバー -->
      <div class="ws-toolbar">
        <span class="ws-toolbar-spacer"></span>
        <button type="button" class="ws-toolbar-btn" aria-label="Add group" data-tooltip="Add group" @click="startAddGroup">
          <span class="mdi mdi-folder-plus-outline"></span>
        </button>
      </div>

      <div ref="wsListEl" class="terminal-ws-list">
        <!-- グループなしのワークスペース -->
        <div
          v-for="(ws, idx) in ungrouped"
          :key="ws.name"
          class="picker-ws-group"
          :class="{ dragging: dragIdx === idx }"
          :style="dragIdx === idx ? { transform: `translateY(${dragOffsetY}px)` } : {}"
        >
          <div class="picker-ws-row picker-ws-row-top">
            <button type="button" class="picker-ws-header-label" @click="openDetail(ws)">
              <span v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
              <span class="picker-ws-header-text">
                <span class="picker-ws-name">
                  <span v-if="ws.worktree" class="mdi mdi-file-tree picker-ws-wt-icon" aria-label="worktree" data-tooltip="worktree"></span>
                  {{ ws.worktree ? workspaceDisplayName(ws) : ws.name }}
                </span>
                <span class="picker-ws-branch">{{ ws.branch || '-' }}</span>
              </span>
            </button>
            <div class="picker-ws-top-meta" @click.stop>
              <template v-if="ws.is_git_repo">
                <button v-if="ws.clean === false" type="button" class="git-badge dirty" v-html="dirtyBadgeHtml(ws)" @click.stop="openDetail(ws)"></button>
                <GitActionBtn v-if="ws.behind > 0" icon="pull" title="Pull" :count="ws.behind" :running="isRunning(ws.name, 'pull')" btn-class="picker-ws-mini-btn pull-btn has-count" @action="doAction(ws, 'pull')" />
                <GitActionBtn v-if="ws.ahead > 0 && ws.has_upstream !== false" icon="push" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push')" btn-class="picker-ws-mini-btn push-btn has-count" @action="doAction(ws, 'push')" />
                <GitActionBtn v-if="ws.ahead > 0 && ws.has_upstream === false" icon="push-upstream" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push-upstream')" btn-class="picker-ws-mini-btn upstream-btn" @action="doAction(ws, 'push-upstream')" />
              </template>
              <button type="button" class="picker-ws-edit-btn" aria-label="Edit workspace" data-tooltip="Edit workspace" @click.stop="openEditWs(ws)">
                <span class="mdi mdi-pencil-outline"></span>
              </button>
            </div>
          </div>
          <div v-if="worktreesByBase[ws.name]?.length" class="picker-ws-worktrees">
            <div v-for="wt in worktreesByBase[ws.name]" :key="wt.name" class="picker-ws-worktree-item">
              <button type="button" class="picker-ws-worktree-open" @click="openDetail(wt)">
                <span class="mdi mdi-file-tree picker-ws-wt-child-icon"></span>
                <span class="picker-ws-worktree-branch">{{ worktreeBranchLabel(wt.worktree_branch || wt.branch) }}</span>
                <span v-if="wt.clean === false" class="picker-ws-wt-dirty" aria-label="uncommitted changes"></span>
              </button>
              <button type="button" class="picker-ws-worktree-del" aria-label="Remove worktree" data-tooltip="Remove worktree" @click.stop="removeWorktree(ws, wt)">
                <span class="mdi mdi-delete-outline"></span>
              </button>
            </div>
          </div>
        </div>

        <!-- グループ -->
        <div v-for="group in workspaceStore.groups" :key="group.id" class="picker-group">
          <div class="picker-group-header">
            <button type="button" class="picker-group-toggle" @click="toggleGroup(group.id)">
              <span class="mdi" :class="collapsedGroups.has(group.id) ? 'mdi-chevron-right' : 'mdi-chevron-down'"></span>
              {{ group.name }}
            </button>
            <button type="button" class="picker-ws-edit-btn" aria-label="Edit group" data-tooltip="Edit group" @click.stop="startRenameGroup(group)">
              <span class="mdi mdi-pencil-outline"></span>
            </button>
          </div>
          <div v-if="!collapsedGroups.has(group.id)" class="picker-group-body">
            <div
              v-for="ws in groupedWorkspaces(group.id)"
              :key="ws.name"
              class="picker-ws-group picker-ws-group-inset"
            >
              <div class="picker-ws-row picker-ws-row-top">
                <button type="button" class="picker-ws-header-label" @click="openDetail(ws)">
                  <span v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
                  <span class="picker-ws-header-text">
                    <span class="picker-ws-name">{{ ws.name }}</span>
                    <span class="picker-ws-branch">{{ ws.branch || '-' }}</span>
                  </span>
                </button>
                <div class="picker-ws-top-meta" @click.stop>
                  <template v-if="ws.is_git_repo">
                    <button v-if="ws.clean === false" type="button" class="git-badge dirty" v-html="dirtyBadgeHtml(ws)" @click.stop="openDetail(ws)"></button>
                    <GitActionBtn v-if="ws.behind > 0" icon="pull" title="Pull" :count="ws.behind" :running="isRunning(ws.name, 'pull')" btn-class="picker-ws-mini-btn pull-btn has-count" @action="doAction(ws, 'pull')" />
                    <GitActionBtn v-if="ws.ahead > 0 && ws.has_upstream !== false" icon="push" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push')" btn-class="picker-ws-mini-btn push-btn has-count" @action="doAction(ws, 'push')" />
                    <GitActionBtn v-if="ws.ahead > 0 && ws.has_upstream === false" icon="push-upstream" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push-upstream')" btn-class="picker-ws-mini-btn upstream-btn" @action="doAction(ws, 'push-upstream')" />
                  </template>
                  <button type="button" class="picker-ws-edit-btn" aria-label="Edit workspace" data-tooltip="Edit workspace" @click.stop="openEditWs(ws)">
                    <span class="mdi mdi-pencil-outline"></span>
                  </button>
                </div>
              </div>
              <div v-if="worktreesByBase[ws.name]?.length" class="picker-ws-worktrees">
                <div v-for="wt in worktreesByBase[ws.name]" :key="wt.name" class="picker-ws-worktree-item">
                  <button type="button" class="picker-ws-worktree-open" @click="openDetail(wt)">
                    <span class="mdi mdi-file-tree picker-ws-wt-child-icon"></span>
                    <span class="picker-ws-worktree-branch">{{ worktreeBranchLabel(wt.worktree_branch || wt.branch) }}</span>
                    <span v-if="wt.clean === false" class="picker-ws-wt-dirty" aria-label="uncommitted changes"></span>
                  </button>
                  <button type="button" class="picker-ws-worktree-del" aria-label="Remove worktree" data-tooltip="Remove worktree" @click.stop="removeWorktree(ws, wt)">
                    <span class="mdi mdi-delete-outline"></span>
                  </button>
                </div>
              </div>
            </div>
            <div v-if="!groupedWorkspaces(group.id).length" class="picker-group-empty">No workspaces</div>
          </div>
        </div>

        <div v-if="displayWorkspaces.length === 0" class="clone-repo-empty">
          No workspaces to display
        </div>
      </div>
    </div>

    <!-- グループ名入力モーダル -->
    <div v-if="groupDialogOpen" class="picker-group-overlay" @click.self="groupDialogOpen = false">
      <div class="picker-group-dialog" role="dialog" aria-modal="true">
        <div class="picker-group-dialog-title">{{ editingGroup ? 'Rename group' : 'Add group' }}</div>
        <input
          ref="groupInputEl"
          v-model="groupInputName"
          class="form-input"
          type="text"
          placeholder="Group name"
          autocomplete="off"
          @keydown.enter.prevent="submitGroupDialog"
          @keydown.esc.prevent="groupDialogOpen = false"
        />
        <div class="picker-group-dialog-buttons">
          <button v-if="editingGroup" class="prompt-btn prompt-btn-danger" @click="deleteGroup(editingGroup)">Delete</button>
          <span class="picker-group-dialog-spacer"></span>
          <button class="prompt-btn prompt-btn-cancel" @click="groupDialogOpen = false">Cancel</button>
          <button class="prompt-btn prompt-btn-ok" :disabled="!groupInputName.trim()" @click="submitGroupDialog">
            {{ editingGroup ? 'Rename' : 'Create' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// グループの折りたたみ状態をモジュールスコープで保持（再マウント後も維持）
const _collapsedGroups = new Set();
</script>

<script setup>
import { computed, inject, ref, reactive, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useToast } from "../composables/useToast.js";
import { renderIconStr } from "../utils/render-icon.js";
import { dirtyBadgeHtml } from "../utils/git.js";
import { worktreeBranchLabel, workspaceDisplayName } from "../utils/worktree.js";
import GitActionBtn from "./GitActionBtn.vue";
import { useWorkspaceDrag } from "../composables/useWorkspaceDrag.js";
import { EP_WORKSPACE_ORDER, EP_GROUPS } from "../utils/endpoints.js";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "Workspaces";

const workspaceStore = useWorkspaceStore();
const { apiGet, apiPost, apiPut, apiDelete, wsEndpoint } = useApi();
const { confirm } = useConfirm();
const toast = useToast();
const { gitAction, isRunning } = useGitRemoteAction();

const wsListEl = ref(null);
const collapsedGroups = reactive(_collapsedGroups);

// グループダイアログ
const groupDialogOpen = ref(false);
const groupInputName = ref("");
const groupInputEl = ref(null);
const editingGroup = ref(null);

// グループなし（トップレベルに表示）
const ungrouped = computed(() => {
  const list = workspaceStore.visibleWorkspaces;
  const baseNames = new Set(list.filter((w) => !w.worktree).map((w) => w.name));
  return list.filter((w) =>
    !w.group_id &&
    !(w.worktree && w.worktree_base && baseNames.has(w.worktree_base))
  );
});

// グループ内のワークスペース
function groupedWorkspaces(groupId) {
  const list = workspaceStore.visibleWorkspaces;
  const baseNames = new Set(list.filter((w) => !w.worktree).map((w) => w.name));
  return list.filter((w) =>
    w.group_id === groupId &&
    !(w.worktree && w.worktree_base && baseNames.has(w.worktree_base))
  );
}

const displayWorkspaces = computed(() => workspaceStore.visibleWorkspaces);

const worktreesByBase = computed(() => {
  const map = {};
  for (const ws of workspaceStore.visibleWorkspaces) {
    if (ws.worktree && ws.worktree_base) {
      (map[ws.worktree_base] ||= []).push(ws);
    }
  }
  return map;
});

const { dragIdx, dragOffsetY, onDragStart, cleanup: cleanupDrag } = useWorkspaceDrag({
  items: ungrouped,
  listEl: wsListEl,
  onReorder: () => saveWorkspaceOrder(),
});

function toggleGroup(groupId) {
  if (collapsedGroups.has(groupId)) {
    collapsedGroups.delete(groupId);
  } else {
    collapsedGroups.add(groupId);
  }
}

function startAddGroup() {
  editingGroup.value = null;
  groupInputName.value = "";
  groupDialogOpen.value = true;
  nextTick(() => groupInputEl.value?.focus());
}

function startRenameGroup(group) {
  editingGroup.value = group;
  groupInputName.value = group.name;
  groupDialogOpen.value = true;
  nextTick(() => groupInputEl.value?.focus());
}

async function submitGroupDialog() {
  const name = groupInputName.value.trim();
  if (!name) return;
  groupDialogOpen.value = false;
  if (editingGroup.value) {
    const { ok } = await apiPut(`${EP_GROUPS}/${editingGroup.value.id}`, { name }, { errorMessage: "Failed to rename group" });
    if (ok) await workspaceStore.fetchGroups();
  } else {
    const { ok } = await apiPost(EP_GROUPS, { name }, { errorMessage: "Failed to create group" });
    if (ok) await workspaceStore.fetchGroups();
  }
}

async function deleteGroup(group) {
  groupDialogOpen.value = false;
  if (!await confirm(`Delete group "${group.name}"? Workspaces in this group will be unassigned.`)) return;
  const { ok } = await apiDelete(`${EP_GROUPS}/${group.id}`, { errorMessage: "Failed to delete group" });
  if (!ok) return;
  await workspaceStore.fetchGroups();
  await workspaceStore.fetchWorkspaces();
}

async function saveWorkspaceOrder() {
  const order = ungrouped.value.map((ws) => ws.id || ws.name);
  try {
    await apiPut(EP_WORKSPACE_ORDER, { order }, { errorMessage: "Failed to save workspace order" });
  } catch { /* ignore */ }
}

function doAction(ws, action) {
  gitAction(ws.name, action, { branch: ws.branch });
}

async function loadWorkspaceOverview() {
  await workspaceStore.fetchGroups();
  await workspaceStore.fetchWorkspaces();
  await workspaceStore.fetchStatuses();
}

function openDetail(ws) {
  workspaceStore.selectedWorkspace = ws.name;
  pushView("WorkspaceDetail", { detail: {} });
}

function openEditWs(ws) {
  pushView("WorkspaceEdit", { workspace: ws });
}

async function removeWorktree(base, wt) {
  const label = worktreeBranchLabel(wt.worktree_branch || wt.branch) || wt.name;
  if (!await confirm(`Remove worktree "${label}"? The working tree directory will be deleted. This cannot be undone.`)) return;
  const { ok } = await apiDelete(wsEndpoint(base.name, "worktrees"), {
    body: { path: wt.path },
    checkStatus: true,
    errorMessage: "Failed to remove worktree",
  });
  if (!ok) return;
  await workspaceStore.fetchWorkspaces();
  toast.success("Worktree removed");
}

onMounted(() => {
  loadWorkspaceOverview();
});

onBeforeUnmount(() => {
  cleanupDrag();
});
</script>

<style scoped>
.split-tab-content {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-height: 0;
  overflow: visible;
}

.split-tab-scroll {
  padding-top: 4px;
}

.terminal-ws-list {
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.picker-ws-group {
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  position: relative;
}

.picker-ws-group.dragging {
  opacity: 0.72;
  background: var(--bg-tertiary);
}

.picker-ws-group-inset {
  border-bottom: none;
}

.picker-ws-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.picker-ws-row-top {
  padding-bottom: 4px;
}

.picker-ws-header-label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}

.picker-ws-header-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  flex: 1;
}

.picker-ws-name {
  min-width: 0;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.picker-ws-wt-icon {
  font-size: 13px;
  color: var(--accent);
  margin-right: 2px;
}

.picker-ws-worktrees {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 12px 8px 28px;
}

.picker-ws-worktree-item {
  display: flex;
  align-items: center;
  border-left: 2px solid var(--border);
}

.picker-ws-worktree-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.picker-ws-worktree-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  min-width: 34px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--error);
  font-size: 16px;
  cursor: pointer;
}

.picker-ws-wt-child-icon {
  font-size: 13px;
  color: var(--accent);
  flex-shrink: 0;
}

.picker-ws-worktree-branch {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-ws-wt-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5a623;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .picker-ws-row-top:hover {
    background: var(--bg-tertiary);
  }

  .picker-ws-worktree-open:hover {
    background: var(--bg-tertiary);
  }

  .picker-ws-worktree-del:hover {
    background: var(--error-bg-20, rgba(255, 85, 114, 0.15));
  }
}

.picker-ws-branch {
  max-width: 100%;
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-ws-top-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.picker-ws-top-meta :deep(.git-badge),
.picker-ws-top-meta :deep(.picker-ws-mini-btn),
.picker-ws-top-meta :deep(.git-action-btn) {
  height: 22px;
  min-height: 22px;
  max-height: 22px;
  min-width: auto;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1;
}

.picker-ws-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .picker-ws-edit-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

.picker-ws-mini-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-muted);
  cursor: pointer;
}

.picker-ws-mini-btn .mdi {
  font-size: 12px;
}

.picker-ws-mini-btn.pull-btn.has-count {
  color: var(--warning);
  background: var(--warning-bg-20);
  border-color: rgba(238, 166, 68, 0.3);
}

.picker-ws-mini-btn.push-btn.has-count {
  color: var(--accent);
  background: rgba(130, 170, 255, 0.15);
  border-color: rgba(130, 170, 255, 0.3);
}

.picker-ws-mini-btn.upstream-set-btn {
  color: var(--warning);
  background: rgba(238, 166, 68, 0.15);
  border-color: rgba(238, 166, 68, 0.3);
}

.picker-ws-mini-btn.upstream-btn {
  color: var(--success);
  background: rgba(120, 200, 140, 0.15);
  border-color: rgba(120, 200, 140, 0.3);
}

.picker-ws-mini-btn.running {
  pointer-events: none;
  color: transparent;
}

.picker-ws-mini-btn.running > * {
  visibility: hidden;
}

.git-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

button.git-badge:disabled {
  opacity: 0.5;
  cursor: default;
}

.git-badge.clean {
  color: var(--success);
  background: var(--success-bg-20);
}

.git-badge.dirty {
  color: var(--warning);
  background: var(--warning-bg-20);
  gap: 4px;
  font-size: 12px;
}

/* グループ */
.picker-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px 6px 12px;
  box-sizing: border-box;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-tertiary) 60%, transparent);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
}

.picker-group-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: inherit;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (hover: hover) and (pointer: fine) {
  .picker-group-toggle:hover {
    color: var(--text-primary);
  }
}

.picker-group-body {
  padding: 0 0 4px 12px;
  border-left: 2px solid var(--border);
  margin-left: 16px;
}

.picker-group-empty {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}

.ws-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.ws-toolbar-spacer {
  flex: 1;
}

.ws-toolbar-btn {
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

@media (hover: hover) and (pointer: fine) {
  .ws-toolbar-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

/* グループ名ダイアログ */
.picker-group-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
  padding: 20px;
}

.picker-group-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  width: min(320px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.picker-group-dialog-title {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.picker-group-dialog-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

.picker-group-dialog-spacer {
  flex: 1;
}

.prompt-btn-danger {
  padding: 6px 14px;
  background: transparent;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  color: var(--error);
  font-size: 13px;
  cursor: pointer;
}

.clone-repo-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
