<template>
  <div class="git-worktree-pane-wrapper">
    <div class="modal-scroll-body">
      <div class="branch-section-header">
        <span>WORKTREES</span>
        <button type="button" class="branch-section-add-btn" title="Create worktree" data-tooltip="Create worktree" @click="createWorktree">
          <span class="mdi mdi-plus"></span>
        </button>
      </div>
      <div
        v-for="wt in worktrees"
        :key="wt.path"
        :class="['branch-item', { current: wt.is_main }]"
        @click="switchTo(wt)"
      >
        <div class="branch-item-name">
          <span class="mdi mdi-file-tree worktree-icon"></span>
          {{ wt.branch || (wt.detached ? '(detached)' : '(no branch)') }}
          <span v-if="wt.is_main" class="worktree-main-tag">main</span>
          <div class="worktree-path">{{ wt.path }}</div>
        </div>
        <div class="branch-item-actions" @click.stop>
          <button
            v-if="!wt.is_main"
            type="button"
            class="commit-action-item commit-action-danger"
            @click="removeWorktree(wt)"
          >Remove</button>
        </div>
      </div>
      <div v-if="!loading && worktrees.length === 0" class="branch-item-empty">No worktrees</div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useApi } from "../composables/useApi.js";
import { useWorkspace } from "../composables/useWorkspace.js";
import { useConfirm } from "../composables/useConfirm.js";
import { usePrompt } from "../composables/usePrompt.js";
import { useToast } from "../composables/useToast.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";

const worktreeEmit = defineEmits(["count"]);

const { apiGet, apiCommand, apiDelete, wsEndpoint } = useApi();
const { withWorkspace } = useWorkspace();
const { confirm } = useConfirm();
const { prompt } = usePrompt();
const toast = useToast();
const workspaceStore = useWorkspaceStore();

const worktrees = ref([]);
const loading = ref(false);

async function load() {
  await withWorkspace(async (workspace) => {
    loading.value = true;
    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "worktrees"));
      if (!ok) return;
      worktrees.value = data?.worktrees || [];
      worktreeEmit("count", worktrees.value.length);
    } finally {
      loading.value = false;
    }
  });
}

async function createWorktree() {
  await withWorkspace(async (workspace) => {
    const branch = await prompt({
      title: "Create Worktree",
      message: "Enter a branch name. A new working tree is created on this branch.",
      placeholder: "feature/example",
    });
    if (!branch) return;
    const { ok, data } = await apiCommand(
      wsEndpoint(workspace, "worktrees"),
      { branch },
      { errorMessage: "Failed to create worktree" },
    );
    if (!ok) return;
    await workspaceStore.fetchWorkspaces();
    await load();
    const created = data?.workspace;
    if (created?.name) {
      toast.success(`Worktree "${created.branch}" created`);
      switchToWorkspace(created.name);
    }
  });
}

function switchTo(wt) {
  if (!wt.workspace) {
    if (wt.is_main) switchToWorkspace(workspaceStore.selectedWorkspace);
    return;
  }
  switchToWorkspace(wt.workspace);
}

function switchToWorkspace(name) {
  const ws = workspaceStore.allWorkspaces.find((w) => w.name === name);
  emit("modal:close");
  emit("terminal:launch", {
    workspace: name,
    icon: ws?.icon,
    iconColor: ws?.icon_color,
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
    await load();
    toast.success("Worktree removed");
  });
}

defineExpose({ load });
</script>

<style scoped>
.git-worktree-pane-wrapper {
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.branch-item:last-child {
  border-bottom: none;
}

.branch-item.current {
  color: var(--accent);
}

.branch-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.worktree-icon {
  font-size: 14px;
  margin-right: 4px;
  color: var(--text-muted);
}

.worktree-main-tag {
  margin-left: 6px;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--radius);
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.worktree-path {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.branch-item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.branch-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  min-height: 36px;
  box-sizing: border-box;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-tertiary) 60%, transparent);
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
}

.branch-section-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.branch-item-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-style: italic;
  font-size: 13px;
}
</style>
