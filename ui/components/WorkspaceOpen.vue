<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <div class="ws-toolbar-actions">
        <button type="button" class="ws-toolbar-btn hover-bg-text" aria-label="Add workspace" data-tooltip="Add workspace" @click="pushView('WorkspaceAdd')">
          <span class="mdi mdi-plus"></span>
          <span class="ws-toolbar-btn-label">WS</span>
        </button>
        <button type="button" class="ws-toolbar-btn hover-bg-text" aria-label="Add group" data-tooltip="Add group" @click="groupDialog?.openAdd()">
          <span class="mdi mdi-plus"></span>
          <span class="ws-toolbar-btn-label">Group</span>
        </button>
        <button type="button" class="ws-toolbar-btn hover-bg-text" aria-label="Add job" data-tooltip="Add job" @click="openAddJob">
          <span class="mdi mdi-plus"></span>
          <span class="ws-toolbar-btn-label">Job</span>
        </button>
        <button
          type="button"
          class="ws-toolbar-btn hover-bg-text"
          :class="{ active: isEditMode }"
          :aria-label="isEditMode ? 'Done editing' : 'Edit'"
          :data-tooltip="isEditMode ? 'Done editing' : 'Edit'"
          @click="isEditMode = !isEditMode"
        >
          <span class="mdi" :class="isEditMode ? 'mdi-check' : 'mdi-pencil-outline'"></span>
          <span class="ws-toolbar-btn-label">{{ isEditMode ? 'Done' : 'Edit' }}</span>
        </button>
      </div>

      <template v-if="recentJobs.length">
        <div class="settings-category-head">
          <span class="settings-category-title">Recent Jobs</span>
        </div>
        <RecentJobsList :edit-mode="isEditMode" />
      </template>

      <div class="settings-category-head">
        <span class="settings-category-title">Workspaces</span>
        <span class="ws-toolbar-spacer"></span>
        <button v-if="!isEditMode" type="button" class="ws-toolbar-btn ws-toolbar-btn-terminal hover-bg-text" aria-label="New terminal" data-tooltip="New terminal" @click="openBareTerminal">
          <span class="mdi mdi-console"></span>
          <span class="ws-toolbar-btn-label">Terminal</span>
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
              v-if="isEditMode && workspaceStore.groups.length > 1"
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
            <button v-if="isEditMode" type="button" class="picker-ws-edit-btn hover-bg-text" aria-label="Edit group" data-tooltip="Edit group" @click.stop="groupDialog?.openRename(item.group)">
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
            <div class="picker-ws-row picker-ws-row-top hover-bg">
              <span
                v-if="isEditMode"
                class="drag-handle picker-ws-drag-handle"
                aria-hidden="true"
                @pointerdown.prevent="onDragStart($event, flatIdx)"
              >
                <span class="mdi mdi-drag-vertical"></span>
              </span>
              <button type="button" class="picker-ws-header-label" @click="toggleJobs(item.ws)">
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
                <button v-if="item.ws.is_git_repo && item.ws.clean === false && !isEditMode" type="button" class="git-badge dirty" v-html="dirtyBadgeHtml(item.ws)" @click.stop="openChanges(item.ws)"></button>
                <template v-if="item.ws.is_git_repo && !isEditMode">
                  <GitActionBtn v-if="item.ws.behind > 0" icon="pull" title="Pull" :count="item.ws.behind" :running="isRunning(item.ws.name, 'pull')" btn-class="picker-ws-mini-btn pull-btn has-count" @action="doAction(item.ws, 'pull')" />
                  <GitActionBtn v-if="item.ws.ahead > 0" icon="push" title="Push" :count="item.ws.ahead" :running="isRunning(item.ws.name, pushActionFor(item.ws))" btn-class="picker-ws-mini-btn push-btn has-count" @action="doAction(item.ws, pushActionFor(item.ws))" />
                </template>
                <template v-if="isEditMode">
                  <button type="button" class="picker-ws-edit-btn hover-bg-text" aria-label="Edit workspace" data-tooltip="Edit workspace" @click.stop="openEditWs(item.ws)">
                    <span class="mdi mdi-pencil-outline"></span>
                  </button>
                </template>
              </div>
              <span class="mdi picker-ws-jobs-chevron" :class="expandedWorkspace === item.ws.name ? 'mdi-chevron-up' : 'mdi-chevron-down'" aria-hidden="true"></span>
            </div>
            <div v-if="expandedWorkspace === item.ws.name" class="picker-ws-jobs-inline">
              <WorkspaceJobsPane :workspace="item.ws.name" :edit-mode="isEditMode" />
            </div>
            <div v-if="worktreesByBase[item.ws.name]?.length" class="picker-ws-worktrees">
              <template v-for="wt in worktreesByBase[item.ws.name]" :key="wt.name">
                <div class="picker-ws-worktree-item">
                  <button type="button" class="picker-ws-worktree-open hover-bg" @click="toggleJobs(wt)">
                    <span class="mdi mdi-file-tree picker-ws-wt-child-icon"></span>
                    <span class="picker-ws-worktree-branch">{{ worktreeBranchLabel(wt.worktree_branch || wt.branch) }}</span>
                    <span v-if="wt.clean === false" class="picker-ws-wt-dirty" aria-label="uncommitted changes"></span>
                  </button>
                  <button v-if="isEditMode" type="button" class="picker-ws-worktree-del" aria-label="Remove worktree" data-tooltip="Remove worktree" @click.stop="removeWorktree(item.ws, wt)">
                    <span class="mdi mdi-delete-outline"></span>
                  </button>
                  <span class="mdi picker-ws-jobs-chevron" :class="expandedWorkspace === wt.name ? 'mdi-chevron-up' : 'mdi-chevron-down'" aria-hidden="true"></span>
                </div>
                <div v-if="expandedWorkspace === wt.name" class="picker-ws-jobs-inline">
                  <WorkspaceJobsPane :workspace="wt.name" :edit-mode="isEditMode" />
                </div>
              </template>
            </div>
          </div>
        </template>

        <div v-if="displayWorkspaces.length === 0" class="clone-repo-empty">
          No workspaces to display
        </div>
        </template>
      </div>

      <template v-if="detachedSessions.length">
        <div class="settings-category-head">
          <span class="settings-category-title">Detached Sessions</span>
        </div>
        <DetachedSessionsList />
      </template>
    </div>

    <!-- グループ名入力モーダル -->
    <WorkspaceGroupDialog ref="groupDialog" />
  </div>
</template>

<script lang="ts">
// グループの折りたたみ状態をモジュールスコープで保持（再マウント後も維持）
const _collapsedGroups = new Set<string>();
</script>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onBeforeUnmount, watch } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.ts";
import { useRecentJobs } from "../composables/useRecentJobs.ts";
import { useDetachedSessions } from "../composables/useDetachedSessions.ts";
import { useApi } from "../composables/useApi.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { useToast } from "../composables/useToast.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { dirtyBadgeHtml } from "../utils/git.ts";
import { worktreeBranchLabel, workspaceDisplayName, removeWorktreeConfirmMessage } from "../utils/worktree.ts";
import { useWorktreeRemove } from "../composables/useWorktreeRemove.ts";
import { useWorktreeCleanup } from "../composables/useWorktreeCleanup.ts";
import GitActionBtn from "./GitActionBtn.vue";
import WorkspaceGroupDialog from "./WorkspaceGroupDialog.vue";
import RecentJobsList from "./RecentJobsList.vue";
import DetachedSessionsList from "./DetachedSessionsList.vue";
import WorkspaceJobsPane from "./WorkspaceJobsPane.vue";
import { EP_WORKSPACE_ORDER, EP_GROUP_ORDER } from "../utils/endpoints.ts";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { useListDragSort } from "../composables/useListDragSort.ts";
import { useWorkspaceListDrag } from "../composables/useWorkspaceListDrag.ts";
import { buildFlatList, deriveGroupChanges, workspacesInGroup } from "../utils/workspace-groups.ts";
import { useModalView } from "../composables/useModalView.ts";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";

// useModalView の各値は inject（default null はテスト用）。実行時は常に
// provide されるため non-null で扱う。
const modalView = useModalView();
const modalTitle = modalView.modalTitle!;
const pushView = modalView.pushView!;
const popView = modalView.popView!;
const { canNavigateBack, closeNav } = useSessionOpenNav();
modalTitle.value = "Open Session";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();
const { apiGet, apiPut, wsEndpoint } = useApi();
const { removeWorktreeRequest } = useWorktreeRemove();
const { findResidue, cleanupResidue } = useWorktreeCleanup();
const { confirm } = useConfirm();
const toast = useToast();
const { gitAction, isRunning } = useGitRemoteAction();
const { recentJobs, loadRecentJobs } = useRecentJobs();
const { detachedSessions, loadDetachedSessions } = useDetachedSessions();

const wsListEl = ref<HTMLElement | null>(null);
const collapsedGroups = reactive(_collapsedGroups);

// グループダイアログ
const groupDialog = ref<InstanceType<typeof WorkspaceGroupDialog> | null>(null);

// グループなし（トップレベル）。フィルタ規則は workspacesInGroup（共通）参照。
const ungrouped = computed(() => workspacesInGroup(workspaceStore.allWorkspaces, null));

// グループ内のワークスペース
function groupedWorkspaces(groupId: string) {
  return workspacesInGroup(workspaceStore.allWorkspaces, groupId);
}

const displayWorkspaces = computed(() => workspaceStore.allWorkspaces);

// グループヘッダーとワークスペースを1本のリストに統合
// type:'header' はグループ見出し、type:'ws' はワークスペース行
// 要素型は useWorkspaceListDrag.ts の FlatRow と同形にする（dragFlatList と
// 合流させてテンプレートで区別なく扱うため。header/ws の判別は item.type）。
const flatList = computed<({ type: string } & Record<string, any>)[]>(() =>
  buildFlatList(ungrouped.value, workspaceStore.groups, groupedWorkspaces, collapsedGroups),
);

const worktreesByBase = computed(() => {
  const map: Record<string, Record<string, any>[]> = {};
  for (const ws of workspaceStore.allWorkspaces) {
    if (ws.worktree && ws.worktree_base) {
      (map[ws.worktree_base] ||= []).push(ws);
    }
  }
  return map;
});

// ---- グループドラッグ ----
const { dragFromIdx, dragOverIdx: groupDragOver, onDragStart: onGroupDragStart } = useListDragSort({
  rowSelector: ".picker-group-header",
  onReorder: async (from, to) => {
    const groups = [...workspaceStore.groups];
    const [moved] = groups.splice(from, 1);
    groups.splice(to, 0, moved);
    await apiPut(EP_GROUP_ORDER, { order: groups.map((g) => g.id) }, { errorMessage: "Failed to save group order" });
    await workspaceStore.fetchGroups();
  },
});
// null は「非ドラッグ中」（テンプレートの数値比較は常に false になる）。
// 比較式の型エラーを避けるため number として扱う（実行時の値・挙動は不変）。
const groupDragFrom = computed(() => dragFromIdx.value as number);

// ---- ワークスペースドラッグ ----
const { dragIdx, dragOffsetY, dragFlatList, onDragStart, cleanup: cleanupWsDrag } = useWorkspaceListDrag({
  flatList,
  listEl: wsListEl,
  onReorder: _saveOrderAndGroups,
});

async function _saveOrderAndGroups(finalList: ({ type: string } & Record<string, any>)[]) {
  const { changes: groupChanges, visibleOrder } = deriveGroupChanges(finalList as Parameters<typeof deriveGroupChanges>[0]);

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

function toggleGroup(groupId: string) {
  if (collapsedGroups.has(groupId)) {
    collapsedGroups.delete(groupId);
  } else {
    collapsedGroups.add(groupId);
  }
}

function doAction(ws: Record<string, any>, action: string) {
  gitAction(ws.name, action, { branch: ws.branch });
}

function pushActionFor(ws: Record<string, any>) {
  return ws.has_upstream === false ? "push-upstream" : "push";
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
  // ワークスペースを開いてもサイドバー/設定は閉じない（WorkspaceJobsPane.vue
  // のopenTerminal/runJobと同様）。
  bridgeEmit("terminal:launch", {});
}

// ワークスペースを1つずつ開かなくても、ツールバーからCommon/Workspace
// どちらのJobも作成できるようにする（Workspaceスコープの場合はJobConfig側の
// プルダウンで対象ワークスペースを選ぶ）。
function openAddJob() {
  pushView("JobConfig", {
    workspaceName: "",
    isCommon: true,
    jobEntry: null,
    onReturn: () => bridgeEmit("jobs:refresh"),
  });
}

// 普段はアイコン・名前・ブランチ・Jobs展開トグルだけの一覧表示にし、
// 並び替え・configの編集・worktree削除はEditモード中だけ操作できるように
// する（誤操作しやすい操作を一覧表示から分離する）。
const isEditMode = ref(false);

// ワークスペース名クリックはJobsをアコーディオン式にインライン展開する
// （モーダルは開かない）。排他的に1つしか開かない（別の行を開くと前の行は閉じる）。
const expandedWorkspace = ref<string | null>(null);

function toggleJobs(ws: Record<string, any>) {
  expandedWorkspace.value = expandedWorkspace.value === ws.name ? null : ws.name;
}

function openChanges(ws: Record<string, any>) {
  workspaceStore.selectedWorkspace = ws.name;
  // WorkspaceDetailはSettingsのスタックとは独立しているため、他のピル等と
  // 同じgit:openFileModalイベント経由で開く（useSettingsNav.ts参照）。
  bridgeEmit("git:openFileModal", { pane: "changes" });
}

function openEditWs(ws: Record<string, any>) {
  pushView("WorkspaceEdit", { workspace: ws });
}

async function removeWorktree(base: Record<string, any>, wt: Record<string, any>) {
  const residue = await findResidue(wt);
  await confirm(removeWorktreeConfirmMessage(wt, {
    openTabs: residue.openTabs.length,
    detachedSessions: residue.detachedSessions.length,
    devServers: residue.devServers.length,
  }), {
    busyLabel: "Removing...",
    run: async () => {
      if (!await removeWorktreeRequest(base.name, wt)) return;
      await cleanupResidue(residue);
      await workspaceStore.fetchWorkspaces();
      toast.success("Worktree removed");
    },
  });
}

onMounted(() => {
  loadWorkspaceOverview();
  loadRecentJobs();
  loadDetachedSessions();
});

// このビューが開いている間にタブがDetachされる（TabItem/TerminalPaneの
// 閉じるダイアログ経由）と開いているタブ数が減る。マウント時の1回取得だけ
// では反映されないため、タブ数が変わるたびに再取得して同期する。
watch(() => terminalStore.openTabs.length, (newLen, oldLen) => {
  loadDetachedSessions();
  // Openページから新規タブを作成した（Workspace/Job/New terminal起動、
  // WorkspaceJobsPane経由も含む）場合は、作られたタブを見に行きやすいよう
  // 自動で戻る。奥のビュー（WorkspaceAdd等）からならWorkspaceOpenルートへ
  // popViewし、既にルートならこのオーバーレイごと閉じてターミナルへ戻す
  // （タブ数が減った時＝Detach等は対象外）。
  if (newLen > oldLen) {
    if (canNavigateBack.value) popView();
    else closeNav();
  }
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

.picker-ws-jobs-chevron {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 16px;
  color: var(--text-muted);
}

.picker-ws-jobs-inline {
  margin: 0 12px 8px 28px;
  border-left: 2px solid var(--border);
  overflow: hidden;
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

/* 行・ボタンの通常ホバー（背景/文字色）は base.css の .hover-bg /
   .hover-bg-text ユーティリティをテンプレート側で付ける。 */
@media (hover: hover) and (pointer: fine) {
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

.ws-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-top: 1px solid var(--border);
}

.ws-toolbar-actions .ws-toolbar-btn {
  flex: 1;
}

.ws-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
}


.ws-toolbar-btn-terminal {
  color: var(--accent);
}

.ws-toolbar-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
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

</style>
