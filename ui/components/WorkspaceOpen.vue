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

      <template v-if="pinnedJobs.length">
        <div class="settings-category-head">
          <span class="settings-category-title">Pinned Jobs</span>
        </div>
        <RecentJobsList variant="pinned" :edit-mode="isEditMode" />
      </template>

      <template v-if="unpinnedRecentJobs.length">
        <div class="settings-category-head">
          <span class="settings-category-title">Recent Jobs</span>
        </div>
        <RecentJobsList variant="recent" :edit-mode="isEditMode" />
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
          <WorkspaceListRow
            v-else
            :ws="item.ws"
            :inset="item.groupId !== null"
            :edit-mode="isEditMode"
            :expanded-workspace="expandedWorkspace"
            :worktrees="worktreesByBase[item.ws.name] || []"
            :dragging="dragIdx === flatIdx"
            :drag-offset-y="dragOffsetY"
            :is-running="isRunning"
            @toggle-jobs="toggleJobs"
            @open-changes="openChanges"
            @git-action="doAction"
            @edit="openEditWs"
            @remove-worktree="removeWorktree"
            @drag-start="(e: PointerEvent) => onDragStart(e, flatIdx)"
          />
        </template>

        <div v-if="workspaceStore.allWorkspaces.length === 0" class="clone-repo-empty">
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
import { workspaceDisplayName, removeWorktreeConfirmMessage } from "../utils/worktree.ts";
import { useWorktreeRemove } from "../composables/useWorktreeRemove.ts";
import { useWorktreeCleanup } from "../composables/useWorktreeCleanup.ts";
import WorkspaceGroupDialog from "./WorkspaceGroupDialog.vue";
import RecentJobsList from "./RecentJobsList.vue";
import DetachedSessionsList from "./DetachedSessionsList.vue";
import WorkspaceListRow from "./WorkspaceListRow.vue";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { buildFlatList, workspacesInGroup } from "../utils/workspace-groups.ts";
import { useModalView } from "../composables/useModalView.ts";
import { useWorkspaceOrdering } from "../composables/useWorkspaceOrdering.ts";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";

// default null はテスト用。実行時は常に provide されるため non-null で扱う。
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
const pinnedJobs = computed(() => recentJobs.value.filter((j) => j.pinned));
const unpinnedRecentJobs = computed(() => recentJobs.value.filter((j) => !j.pinned));
const { detachedSessions, loadDetachedSessions } = useDetachedSessions();

const wsListEl = ref<HTMLElement | null>(null);
const collapsedGroups = reactive(_collapsedGroups);

const groupDialog = ref<InstanceType<typeof WorkspaceGroupDialog> | null>(null);

// グループなし（トップレベル）。フィルタ規則は workspacesInGroup（共通）参照。
const ungrouped = computed(() => workspacesInGroup(workspaceStore.allWorkspaces, null));

function groupedWorkspaces(groupId: string) {
  return workspacesInGroup(workspaceStore.allWorkspaces, groupId);
}

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

// ---- 並べ替え（グループ + ワークスペース。永続化は useWorkspaceOrdering に集約）----
const {
  groupDragFrom,
  groupDragOver,
  onGroupDragStart,
  dragIdx,
  dragOffsetY,
  dragFlatList,
  onDragStart,
  cleanupWsDrag,
} = useWorkspaceOrdering({ flatList, listEl: wsListEl });

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
  // 開いてもサイドバー/設定は閉じない（WorkspaceJobsPane.vue のopenTerminal/runJobと同様）。
  bridgeEmit("terminal:launch", {});
}

// ワークスペースを1つずつ開かなくても、ツールバーからCommon/Workspaceどちらの
// Jobも作成できるようにする（Workspaceスコープの場合はJobConfig側のプルダウンで
// 対象ワークスペースを選ぶ）。
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

.picker-group-drag-handle {
  width: 20px;
  height: 28px;
  font-size: 14px;
}

/* グループヘッダーの編集ボタン（WorkspaceListRow.vue と同一スタイル — scoped のため両方で定義）。 */
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
