<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <template v-if="recentJobs.length">
        <div class="settings-category-head">
          <span class="settings-category-title">Recent Jobs</span>
        </div>
        <div class="picker-recent-jobs">
          <button
            v-for="recent in visibleRecentJobs"
            :key="recent.key"
            type="button"
            class="picker-recent-job-item"
            :class="{ 'is-detached-tab': recent.jobDetachedTab }"
            @click="runRecentJob(recent)"
          >
            <span class="picker-recent-job-icons">
              <span v-if="recent.wsIcon" v-html="renderIconStr(recent.wsIcon, recent.wsIconColor, 18)"></span>
              <span v-if="recent.jobIcon" v-html="renderIconStr(recent.jobIcon, recent.jobIconColor, 18)"></span>
            </span>
            <span class="picker-recent-job-label">
              <span class="picker-recent-job-ws">{{ recent.workspace }}</span>
              <span v-if="recent.jobLabel || recent.jobName" class="picker-recent-job-sep">/</span>
              <span class="picker-recent-job-name">{{ recent.jobLabel || recent.jobName }}</span>
            </span>
            <span
              class="picker-recent-job-pin"
              :class="{ pinned: recent.pinned }"
              role="button"
              tabindex="0"
              :aria-label="recent.pinned ? 'Unpin' : 'Pin'"
              :data-tooltip="recent.pinned ? 'Unpin' : 'Pin'"
              @click.stop="togglePin(recent.key)"
              @keydown.enter.space.stop.prevent="togglePin(recent.key)"
            ><span class="mdi" :class="recent.pinned ? 'mdi-pin' : 'mdi-pin-outline'"></span></span>
          </button>
          <button
            v-if="hasUnpinnedRecentJobs"
            type="button"
            class="picker-recent-jobs-more"
            @click="showAllRecentJobs = !showAllRecentJobs"
          >
            <span class="mdi" :class="showAllRecentJobs ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
            {{ showAllRecentJobs ? 'Less' : 'More' }}
          </button>
        </div>
      </template>

      <div class="settings-category-head">
        <span class="settings-category-title">Workspaces</span>
        <span class="ws-toolbar-spacer"></span>
        <button type="button" class="ws-toolbar-btn ws-toolbar-btn-terminal" aria-label="New terminal" data-tooltip="New terminal" @click="openBareTerminal">
          <span class="mdi mdi-console"></span>
          <span class="ws-toolbar-btn-label">Terminal</span>
        </button>
        <button type="button" class="ws-toolbar-btn" aria-label="Add group" data-tooltip="Add group" @click="groupDialog?.openAdd()">
          <span class="mdi mdi-folder-plus-outline"></span>
        </button>
        <button type="button" class="ws-toolbar-btn" aria-label="Add workspace" data-tooltip="Add workspace" @click="pushView('WorkspaceAdd')">
          <span class="mdi mdi-plus"></span>
        </button>
      </div>

      <div ref="wsListEl" class="terminal-ws-list">
        <div v-if="isLoading" class="clone-repo-empty loading-dots">Loading</div>
        <template v-else>
        <template v-for="(item, flatIdx) in (dragFlatList || flatList)" :key="item.type === 'header' ? 'h-' + item.group.id : item.ws.name">
          <!-- グループヘッダー -->
          <div
            v-if="item.type === 'header'"
            class="picker-group-header"
            :class="{
              'drag-source': groupDragFrom === item.groupIdx,
              'drag-over-above': groupDragOver === item.groupIdx && groupDragFrom > item.groupIdx,
              'drag-over-below': groupDragOver === item.groupIdx && groupDragFrom < item.groupIdx,
            }"
          >
            <span
              v-if="workspaceStore.groups.length > 1"
              class="drag-handle picker-group-drag-handle"
              aria-hidden="true"
              @pointerdown.prevent="onGroupDragStart($event, item.groupIdx)"
            >
              <span class="mdi mdi-drag-vertical"></span>
            </span>
            <button type="button" class="picker-group-toggle" @click="toggleGroup(item.group.id)">
              <span class="mdi" :class="collapsedGroups.has(item.group.id) ? 'mdi-chevron-right' : 'mdi-chevron-down'"></span>
              {{ item.group.name }}
            </button>
            <button type="button" class="picker-ws-edit-btn" aria-label="Edit group" data-tooltip="Edit group" @click.stop="groupDialog?.openRename(item.group)">
              <span class="mdi mdi-pencil-outline"></span>
            </button>
          </div>
          <!-- ワークスペース行 -->
          <div
            v-else
            class="picker-ws-group"
            :class="{ dragging: dragIdx === flatIdx, 'picker-ws-group-inset': item.groupId !== null }"
            :style="dragIdx === flatIdx ? { transform: `translateY(${dragOffsetY}px)` } : {}"
          >
            <div class="picker-ws-row picker-ws-row-top">
              <span
                class="drag-handle picker-ws-drag-handle"
                aria-hidden="true"
                @pointerdown.prevent="onDragStart($event, flatIdx)"
              >
                <span class="mdi mdi-drag-vertical"></span>
              </span>
              <button type="button" class="picker-ws-header-label" @click="openDetail(item.ws)">
                <span v-html="renderIconStr(item.ws.icon || 'mdi-console', item.ws.icon_color, 18)"></span>
                <span class="picker-ws-header-text">
                  <span class="picker-ws-name">
                    <span v-if="item.ws.worktree" class="mdi mdi-file-tree picker-ws-wt-icon" aria-label="worktree" data-tooltip="worktree"></span>
                    {{ item.ws.worktree ? workspaceDisplayName(item.ws) : item.ws.name }}
                  </span>
                  <span class="picker-ws-branch">{{ item.ws.branch || '-' }}</span>
                </span>
              </button>
              <div class="picker-ws-top-meta" @click.stop>
                <template v-if="item.ws.is_git_repo">
                  <button v-if="item.ws.clean === false" type="button" class="git-badge dirty" v-html="dirtyBadgeHtml(item.ws)" @click.stop="openChanges(item.ws)"></button>
                  <GitActionBtn v-if="item.ws.behind > 0" icon="pull" title="Pull" :count="item.ws.behind" :running="isRunning(item.ws.name, 'pull')" btn-class="picker-ws-mini-btn pull-btn has-count" @action="doAction(item.ws, 'pull')" />
                  <GitActionBtn v-if="item.ws.ahead > 0 && item.ws.has_upstream !== false" icon="push" title="Push" :count="item.ws.ahead" :running="isRunning(item.ws.name, 'push')" btn-class="picker-ws-mini-btn push-btn has-count" @action="doAction(item.ws, 'push')" />
                  <GitActionBtn v-if="item.ws.ahead > 0 && item.ws.has_upstream === false" icon="push-upstream" title="Push" :count="item.ws.ahead" :running="isRunning(item.ws.name, 'push-upstream')" btn-class="picker-ws-mini-btn upstream-btn" @action="doAction(item.ws, 'push-upstream')" />
                </template>
                <button type="button" class="picker-ws-edit-btn" aria-label="Edit workspace" data-tooltip="Edit workspace" @click.stop="openEditWs(item.ws)">
                  <span class="mdi mdi-pencil-outline"></span>
                </button>
              </div>
            </div>
            <div v-if="worktreesByBase[item.ws.name]?.length" class="picker-ws-worktrees">
              <div v-for="wt in worktreesByBase[item.ws.name]" :key="wt.name" class="picker-ws-worktree-item">
                <button type="button" class="picker-ws-worktree-open" @click="openDetail(wt)">
                  <span class="mdi mdi-file-tree picker-ws-wt-child-icon"></span>
                  <span class="picker-ws-worktree-branch">{{ worktreeBranchLabel(wt.worktree_branch || wt.branch) }}</span>
                  <span v-if="wt.clean === false" class="picker-ws-wt-dirty" aria-label="uncommitted changes"></span>
                </button>
                <button type="button" class="picker-ws-worktree-del" aria-label="Remove worktree" data-tooltip="Remove worktree" @click.stop="removeWorktree(item.ws, wt)">
                  <span class="mdi mdi-delete-outline"></span>
                </button>
              </div>
            </div>
          </div>
        </template>

        <div v-if="displayWorkspaces.length === 0" class="clone-repo-empty">
          No workspaces to display
        </div>
        </template>
      </div>
    </div>

    <!-- グループ名入力モーダル -->
    <WorkspaceGroupDialog ref="groupDialog" />
  </div>
</template>

<script>
// グループの折りたたみ状態をモジュールスコープで保持（再マウント後も維持）
const _collapsedGroups = new Set();
</script>

<script setup>
import { computed, inject, ref, reactive, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useRecentJobs } from "../composables/useRecentJobs.js";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useToast } from "../composables/useToast.js";
import { renderIconStr } from "../utils/render-icon.js";
import { dirtyBadgeHtml } from "../utils/git.js";
import { worktreeBranchLabel, workspaceDisplayName } from "../utils/worktree.js";
import GitActionBtn from "./GitActionBtn.vue";
import WorkspaceGroupDialog from "./WorkspaceGroupDialog.vue";
import { EP_WORKSPACE_ORDER, EP_GROUP_ORDER } from "../utils/endpoints.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { useListDragSort } from "../composables/useListDragSort.js";
import { useWorkspaceListDrag } from "../composables/useWorkspaceListDrag.js";
import { buildFlatList, deriveGroupChanges } from "../utils/workspace-groups.js";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
modalTitle.value = "Workspaces";

const workspaceStore = useWorkspaceStore();
const { apiGet, apiPut, apiDelete, wsEndpoint } = useApi();
const { confirm } = useConfirm();
const toast = useToast();
const { gitAction, isRunning } = useGitRemoteAction();
const { recentJobs, loadRecentJobs, runRecentJob, togglePin } = useRecentJobs();

// Recent Jobs: 初期表示はピン留めのみ。非ピン留めは「More」で展開する。
const showAllRecentJobs = ref(false);
const hasUnpinnedRecentJobs = computed(() => recentJobs.value.some((j) => !j.pinned));
const visibleRecentJobs = computed(() =>
  showAllRecentJobs.value ? recentJobs.value : recentJobs.value.filter((j) => j.pinned),
);

const wsListEl = ref(null);
const collapsedGroups = reactive(_collapsedGroups);

// グループダイアログ
const groupDialog = ref(null);

// グループなし（トップレベル）
const ungrouped = computed(() => {
  const list = workspaceStore.allWorkspaces;
  const baseNames = new Set(list.filter((w) => !w.worktree).map((w) => w.name));
  return list.filter((w) =>
    !w.group_id &&
    !(w.worktree && w.worktree_base && baseNames.has(w.worktree_base))
  );
});

// グループ内のワークスペース
function groupedWorkspaces(groupId) {
  const list = workspaceStore.allWorkspaces;
  const baseNames = new Set(list.filter((w) => !w.worktree).map((w) => w.name));
  return list.filter((w) =>
    w.group_id === groupId &&
    !(w.worktree && w.worktree_base && baseNames.has(w.worktree_base))
  );
}

const displayWorkspaces = computed(() => workspaceStore.allWorkspaces);

// グループヘッダーとワークスペースを1本のリストに統合
// type:'header' はグループ見出し、type:'ws' はワークスペース行
const flatList = computed(() =>
  buildFlatList(ungrouped.value, workspaceStore.groups, groupedWorkspaces, collapsedGroups),
);

const worktreesByBase = computed(() => {
  const map = {};
  for (const ws of workspaceStore.allWorkspaces) {
    if (ws.worktree && ws.worktree_base) {
      (map[ws.worktree_base] ||= []).push(ws);
    }
  }
  return map;
});

// ---- グループドラッグ ----
const { dragFromIdx: groupDragFrom, dragOverIdx: groupDragOver, onDragStart: onGroupDragStart } = useListDragSort({
  rowSelector: ".picker-group-header",
  onReorder: async (from, to) => {
    const groups = [...workspaceStore.groups];
    const [moved] = groups.splice(from, 1);
    groups.splice(to, 0, moved);
    await apiPut(EP_GROUP_ORDER, { order: groups.map((g) => g.id) }, { errorMessage: "Failed to save group order" });
    await workspaceStore.fetchGroups();
  },
});

// ---- ワークスペースドラッグ ----
const { dragIdx, dragOffsetY, dragFlatList, onDragStart, cleanup: cleanupWsDrag } = useWorkspaceListDrag({
  flatList,
  listEl: wsListEl,
  onReorder: _saveOrderAndGroups,
});

async function _saveOrderAndGroups(finalList) {
  const { changes: groupChanges, visibleOrder } = deriveGroupChanges(finalList);

  // グループ変更を保存
  for (const { ws, newGroupId } of groupChanges) {
    await apiPut(wsEndpoint(ws.name, "config"), {
      icon: ws.icon || "",
      icon_color: ws.icon_color || "",
      group_id: newGroupId,
    }, { errorMessage: "Failed to update group" });
  }

  // 非表示(折りたたみ)のワークスペースを末尾に温存してフル順序を構築
  const allWsIds = workspaceStore.allWorkspaces.map((ws) => ws.id || ws.name);
  const visibleSet = new Set(visibleOrder);
  const hiddenOrder = allWsIds.filter((id) => !visibleSet.has(id));
  const fullOrder = [...visibleOrder, ...hiddenOrder];

  await apiPut(EP_WORKSPACE_ORDER, { order: fullOrder }, { errorMessage: "Failed to save workspace order" });
  await workspaceStore.fetchWorkspaces();
}

function toggleGroup(groupId) {
  if (collapsedGroups.has(groupId)) {
    collapsedGroups.delete(groupId);
  } else {
    collapsedGroups.add(groupId);
  }
}

function doAction(ws, action) {
  gitAction(ws.name, action, { branch: ws.branch });
}

const isLoading = ref(false);

async function loadWorkspaceOverview() {
  // アプリ起動時(useAppBootstrap)で既に一覧取得済みのことが多いため、
  // 既存データがあればLoadingを出さず即表示し、裏で静かに再取得する。
  const hasExistingData = workspaceStore.allWorkspaces.length > 0;
  if (!hasExistingData) isLoading.value = true;
  try {
    await workspaceStore.fetchGroups();
    await workspaceStore.fetchWorkspaces();
  } finally {
    isLoading.value = false;
  }
  // ステータス(git dirty/ahead/behind等)は行ごとの statusLoading 表示で埋まるため、
  // 一覧表示自体はブロックしない。
  workspaceStore.fetchStatuses();
}

function openBareTerminal() {
  bridgeEmit("modal:close");
  bridgeEmit("terminal:launch", {});
}

function openDetail(ws) {
  workspaceStore.selectedWorkspace = ws.name;
  pushView("WorkspaceDetail", { detail: {} });
}

function openChanges(ws) {
  workspaceStore.selectedWorkspace = ws.name;
  pushView("WorkspaceDetail", { detail: { pane: "changes" } });
}

function openEditWs(ws) {
  pushView("WorkspaceEdit", { workspace: ws });
}

async function removeWorktree(base, wt) {
  const label = worktreeBranchLabel(wt.worktree_branch || wt.branch) || wt.name;
  await confirm(`Remove worktree "${label}"? The working tree directory will be deleted. This cannot be undone.`, {
    busyLabel: "Removing...",
    run: async () => {
      const { ok } = await apiDelete(wsEndpoint(base.name, "worktrees"), {
        body: { path: wt.path },
        checkStatus: true,
        errorMessage: "Failed to remove worktree",
      });
      if (!ok) return;
      await workspaceStore.fetchWorkspaces();
      toast.success("Worktree removed");
    },
  });
}

onMounted(() => {
  loadWorkspaceOverview();
  loadRecentJobs();
});

onBeforeUnmount(() => {
  cleanupWsDrag();
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
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 10;
}

.picker-ws-group-inset {
  border-bottom: none;
}

.picker-ws-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  user-select: none;
  -webkit-user-select: none;
}

.picker-ws-drag-handle {
  height: 100%;
}

.picker-group-drag-handle {
  width: 20px;
  height: 28px;
  font-size: 14px;
}

.picker-ws-row-top {
  min-height: 44px;
  padding-bottom: 4px;
  box-sizing: border-box;
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

.picker-ws-top-meta :deep(.git-badge) {
  height: 22px;
  min-height: 22px;
  max-height: 22px;
  min-width: auto;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1;
}

.picker-ws-top-meta :deep(.picker-ws-mini-btn),
.picker-ws-top-meta :deep(.git-action-btn) {
  height: 26px;
  min-height: 26px;
  max-height: 26px;
  min-width: 26px;
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
  margin-left: 4px;
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
.picker-group-header:not(:first-child) {
  margin-top: 4px;
}

.picker-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px 6px 12px;
  box-sizing: border-box;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-tertiary) 60%, transparent);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
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

.picker-ws-group-inset {
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

.ws-toolbar-btn-terminal {
  color: var(--accent);
  gap: 4px;
}

.ws-toolbar-btn-label {
  font-size: 12px;
}

.clone-repo-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.picker-recent-jobs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
}

.picker-recent-job-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 12px 4px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  box-sizing: border-box;
}

@media (hover: hover) and (pointer: fine) {
  .picker-recent-job-item:hover {
    background: var(--bg-tertiary);
  }
}

.picker-recent-job-item.is-detached-tab {
  opacity: 0.6;
}

.picker-recent-job-icons {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  width: 20px;
  margin-right: 4px;
  justify-content: center;
}

.picker-recent-job-label {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.picker-recent-job-ws {
  color: var(--text-muted);
}

.picker-recent-job-sep {
  color: var(--border);
  flex-shrink: 0;
}

.picker-recent-job-name {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-recent-job-pin {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  margin-left: 4px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

.picker-recent-job-pin.pinned {
  color: var(--accent);
}

@media (hover: hover) and (pointer: fine) {
  .picker-recent-job-pin:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

.picker-recent-jobs-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 36px;
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
}

@media (hover: hover) and (pointer: fine) {
  .picker-recent-jobs-more:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}
</style>
