<template>
  <div class="modal-scroll-body open-session-scroll">
    <div class="open-session-content">
      <template v-if="recentJobs.length">
        <div class="settings-category-head">
          <button type="button" class="open-session-section-toggle" :aria-expanded="!collapsedGroups.has('section:recent')" @click="toggleGroup('section:recent')">
            <span class="settings-category-title">Recent</span>
          </button>
          <span class="mdi open-session-section-chevron" :class="collapsedGroups.has('section:recent') ? 'mdi-chevron-right' : 'mdi-chevron-down'" aria-hidden="true" @click="toggleGroup('section:recent')"></span>
        </div>
        <div v-show="!collapsedGroups.has('section:recent')">
          <RecentJobsList v-if="pinnedJobs.length" variant="pinned" />
          <RecentJobsList v-if="unpinnedRecentJobs.length" variant="recent" />
        </div>
      </template>

      <div class="settings-category-head">
        <button type="button" class="open-session-section-toggle" :aria-expanded="!collapsedGroups.has('section:workspace')" @click="toggleGroup('section:workspace')">
          <span class="settings-category-title">Workspace</span>
        </button>
        <button type="button" class="ws-toolbar-btn ws-toolbar-btn-terminal hover-bg-text" aria-label="Add workspace" data-tooltip="Add workspace" @click="pushView('WorkspaceAdd')">
          <span class="mdi mdi-plus"></span>
          <span class="ws-toolbar-btn-label">Add workspace</span>
        </button>
        <span class="mdi open-session-section-chevron" :class="collapsedGroups.has('section:workspace') ? 'mdi-chevron-right' : 'mdi-chevron-down'" aria-hidden="true" @click="toggleGroup('section:workspace')"></span>
      </div>
      <div v-show="!collapsedGroups.has('section:workspace')">
      <div ref="wsListEl" class="terminal-ws-list">
        <div v-if="isLoading" class="workspace-list-empty loading-dots">Loading</div>
        <template v-else>
        <template v-for="(item, flatIdx) in (dragFlatList || flatList)" :key="item.type === 'header' ? 'h-' + item.group.id : item.ws.name">
          <div
            v-if="item.type === 'header'"
            class="ws-group-header"
            :class="{
              'drag-source': groupDragFrom === item.groupIdx,
              'drag-over-above': groupDragOver === item.groupIdx && groupDragFrom > item.groupIdx,
              'drag-over-below': groupDragOver === item.groupIdx && groupDragFrom < item.groupIdx,
            }"
          >
            <span
              v-if="workspaceStore.groups.length > 1"
              class="drag-handle ws-group-drag-handle"
              aria-hidden="true"
              @pointerdown.prevent="onGroupDragStart($event, item.groupIdx)"
            >
              <span class="mdi mdi-drag-vertical"></span>
            </span>
            <button type="button" class="ws-group-toggle" @click="toggleGroup(item.group.id)">
              {{ item.group.name }}
            </button>
            <span class="mdi ws-group-chevron" :class="collapsedGroups.has(item.group.id) ? 'mdi-chevron-right' : 'mdi-chevron-down'" aria-hidden="true" @click="toggleGroup(item.group.id)"></span>
          </div>
          <WorkspaceListRow
            v-else
            :ws="item.ws"
            :inset="item.groupId !== null"
            :worktrees="worktreesByBase[item.ws.name] || []"
            :dragging="dragIdx === flatIdx"
            :drag-offset-y="dragOffsetY"
            :is-running="isRunning"
            @select-job="selectJob"
            @open-changes="openChanges"
            @git-action="doAction"
            @edit="openEditWs"
            @remove-worktree="removeWorktree"
            @drag-start="(e: PointerEvent) => onDragStart(e, flatIdx)"
          />
        </template>

        <div v-if="workspaceStore.allWorkspaces.length === 0" class="workspace-list-empty">
          No workspaces to display
        </div>
        </template>
      </div>
      </div>

      <div class="settings-category-head">
        <button type="button" class="open-session-section-toggle" :aria-expanded="!collapsedGroups.has('section:terminals')" @click="toggleGroup('section:terminals')">
          <span class="settings-category-title">Terminals</span>
        </button>
        <button type="button" class="ws-toolbar-btn ws-toolbar-btn-terminal hover-bg-text" aria-label="New terminal" data-tooltip="New terminal" @click="openBareTerminal">
          <span class="mdi mdi-console"></span>
          <span class="ws-toolbar-btn-label">New terminal</span>
        </button>
        <span class="mdi open-session-section-chevron" :class="collapsedGroups.has('section:terminals') ? 'mdi-chevron-right' : 'mdi-chevron-down'" aria-hidden="true" @click="toggleGroup('section:terminals')"></span>
      </div>
      <div v-show="!collapsedGroups.has('section:terminals')">
      <DetachedSessionsList v-if="detachedSessions.length" />
      <div v-else class="workspace-list-empty">No detached sessions</div>
      </div>

      <div class="settings-category-head">
        <button type="button" class="open-session-section-toggle" :aria-expanded="!collapsedGroups.has('section:job')" @click="toggleGroup('section:job')">
          <span class="settings-category-title">Job</span>
        </button>
        <button type="button" class="ws-toolbar-btn ws-toolbar-btn-terminal hover-bg-text" aria-label="Add job" data-tooltip="Add job" @click="openAddJob">
          <span class="mdi mdi-plus"></span>
          <span class="ws-toolbar-btn-label">Add job</span>
        </button>
        <span class="mdi open-session-section-chevron" :class="collapsedGroups.has('section:job') ? 'mdi-chevron-right' : 'mdi-chevron-down'" aria-hidden="true" @click="toggleGroup('section:job')"></span>
      </div>
      <div v-show="!collapsedGroups.has('section:job')">
      <SessionOpenJobsTab />
      </div>
    </div>

    <WorkspaceJobDialog ref="jobDialog" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, watch } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.ts";
import { useRecentJobs } from "../composables/useRecentJobs.ts";
import { useDetachedSessions } from "../composables/useDetachedSessions.ts";
import { useApi } from "../composables/useApi.ts";
import { useWorktreeRemoveConfirm } from "../composables/useWorktreeRemoveConfirm.ts";
import RecentJobsList from "./RecentJobsList.vue";
import SessionOpenJobsTab from "./SessionOpenJobsTab.vue";
import WorkspaceJobDialog from "./WorkspaceJobDialog.vue";
import DetachedSessionsList from "./DetachedSessionsList.vue";
import WorkspaceListRow from "./WorkspaceListRow.vue";
import { emit as bridgeEmit } from "../app-bridge.ts";
import { buildFlatList, workspacesInGroup } from "../utils/workspace-groups.ts";
import { useModalView } from "../composables/useModalView.ts";
import { useWorkspaceOrdering } from "../composables/useWorkspaceOrdering.ts";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";
import { useCollapsedWorkspaceGroups } from "../composables/useCollapsedWorkspaceGroups.ts";

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
const { confirmAndRemoveWorktree } = useWorktreeRemoveConfirm();
const { gitAction, isRunning } = useGitRemoteAction();
const { recentJobs, loadRecentJobs } = useRecentJobs();
const pinnedJobs = computed(() => recentJobs.value.filter((j) => j.pinned));
const unpinnedRecentJobs = computed(() => recentJobs.value.filter((j) => !j.pinned));
const { detachedSessions, loadDetachedSessions } = useDetachedSessions();

const wsListEl = ref<HTMLElement | null>(null);
const { collapsedGroups, toggleGroup } = useCollapsedWorkspaceGroups();


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

// 追加先（Common / ワークスペース）はJobConfig側のScopeプルダウンで選ぶ。
function openAddJob() {
  pushView("JobConfig", {
    workspaceName: "",
    isCommon: true,
    jobEntry: null,
    onReturn: () => bridgeEmit("jobs:refresh"),
  });
}

// ワークスペース（worktree含む）のジョブはダイアログで選んで起動する。
const jobDialog = ref<InstanceType<typeof WorkspaceJobDialog> | null>(null);

function selectJob(ws: Record<string, any>) {
  jobDialog.value?.open(ws.name);
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

function removeWorktree(base: Record<string, any>, wt: Record<string, any>) {
  return confirmAndRemoveWorktree(base.name, wt);
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
  // 自動で戻る。奥のビュー（WorkspaceAdd等）からならSessionOpenHomeルートへ
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
.open-session-content {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-height: 0;
  overflow: visible;
}

.open-session-section-toggle {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0;
  background: none;
  border: none;
  border-radius: 0;
  color: inherit;
  font: inherit;
  text-align: left;
}

.open-session-section-chevron {
  flex-shrink: 0;
  font-size: 16px;
  cursor: pointer;
}

.open-session-scroll {
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

.ws-group-drag-handle {
  width: 20px;
  height: 28px;
  font-size: 14px;
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

.workspace-list-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

</style>
