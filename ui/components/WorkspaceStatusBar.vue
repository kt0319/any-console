<template>
  <div class="workspace-status-bar" :style="{ display: showHeader ? 'flex' : 'none' }">
    <template v-if="hasVisibleTabs">
      <div class="status-nav-group" ref="navGroupEl">
        <template v-if="showJobsFiles || isPlainTerminal">
          <button v-if="isGitRepo" type="button" class="status-nav-btn" aria-label="Jobs" data-tooltip="Jobs" @click="openFileModal('jobs')">
            <span class="mdi mdi-play-circle-outline status-btn-icon" aria-hidden="true"></span>
            <span v-if="!isMobile" class="status-btn-label" :class="{ 'status-btn-label-always': !isBranchLong }">Jobs</span>
          </button>
          <button
            v-else-if="activeTab"
            type="button"
            class="status-nav-btn status-add-workspace-btn"
            :aria-label="addLabel"
            :data-tooltip="addLabel"
            @click="registerCurrentDir"
          >
            <span class="mdi mdi-folder-plus-outline status-btn-icon" aria-hidden="true"></span>
            <span class="status-btn-label status-btn-label-always">{{ addLabel }}</span>
          </button>
          <div class="status-divider"></div>
          <button type="button" class="status-nav-btn" aria-label="Files" data-tooltip="Files" @click="openFileModal('files')">
            <span class="mdi mdi-folder-outline status-btn-icon" aria-hidden="true"></span>
            <span v-if="!isMobile" class="status-btn-label" :class="{ 'status-btn-label-always': isPlainTerminal || !isBranchLong }">Files</span>
          </button>
          <div class="status-divider"></div>
        </template>
        <button v-if="!isMobile || !isDirty || isPlainTerminal" type="button" class="status-nav-btn status-msg-btn" :class="{ 'status-placeholder-btn': isPlainTerminal }" :disabled="isPlainTerminal" tabindex="-1" aria-label="History" data-tooltip="History" @click="openFileModal('history')">
          <span class="mdi mdi-history status-btn-icon" aria-hidden="true"></span>
          <span v-if="isGitRepo" class="status-msg-text" :class="{ 'status-msg-loading': statusLoading }">{{ msgText }}</span>
          <span v-else class="status-btn-label status-btn-label-always">History</span>
        </button>
        <div v-if="!isMobile || isPlainTerminal" class="status-divider"></div>
        <button v-if="!isMobile || isDirty || isPlainTerminal" type="button" class="status-nav-btn status-numstat-btn" :class="{ 'status-msg-btn': isMobile, 'status-placeholder-btn': isPlainTerminal }" :disabled="isPlainTerminal" tabindex="-1" aria-label="Changes" data-tooltip="Changes" @click="openFileModal('changes')">
          <span class="mdi mdi-file-document-multiple-outline status-btn-icon" aria-hidden="true"></span>
          <template v-if="isDirty && !statusLoading">
            <span v-if="changedFiles > 0" class="numstat-files">{{ changedFiles }}F</span>
            <span class="diff-num-plus">+{{ insertions }}</span>
            <span class="diff-num-del">-{{ deletions }}</span>
          </template>
          <span v-else-if="!isMobile || isPlainTerminal" class="status-btn-label" :class="{ 'status-btn-label-always': isPlainTerminal || !isBranchLong }">Changes</span>
        </button>
        <div class="status-divider"></div>
        <button type="button" class="status-nav-btn status-branch-btn" :class="{ 'status-placeholder-btn': isPlainTerminal }" :disabled="isPlainTerminal" tabindex="-1" aria-label="Branches" data-tooltip="Branches" @click="openFileModal('branch')">
          <span class="mdi mdi-source-branch status-btn-icon" aria-hidden="true"></span>
          <span v-if="isGitRepo" class="status-branch-text"><span v-if="branchParts.abbr" class="branch-abbr">{{ branchParts.abbr }}</span>{{ branchParts.rest }}</span>
          <span v-else class="status-btn-label status-btn-label-always">Branches</span>
        </button>
      </div>
      <div v-if="isGitRepo && !statusLoading && hasGitActions" class="git-actions">
        <GitActionBtn v-if="behind > 0" icon="pull" title="Pull" :count="behind" :running="isRunning(workspace, 'pull')" btn-class="pull-btn has-count" @action="doAction('pull')" />
        <GitActionBtn v-if="!hasUpstream && hasRemoteBranch" icon="set-upstream" title="Set Upstream" :running="isRunning(workspace, 'set-upstream')" btn-class="icon-only upstream-set-btn" @action="doAction('set-upstream')" />
        <GitActionBtn v-if="!hasUpstream && !hasRemoteBranch" icon="push-upstream" title="Push & Set Upstream" :count="ahead" :running="isRunning(workspace, 'push-upstream')" btn-class="upstream-btn" @action="doAction('push-upstream')" />
        <GitActionBtn v-if="hasUpstream && ahead > 0" icon="push" title="Push" :count="ahead" :running="isRunning(workspace, 'push')" btn-class="push-btn has-count" @action="doAction('push')" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useGitRemoteAction } from "../composables/useGitRemoteAction.js";
import { useIsMobile } from "../composables/useIsMobile.js";
import { useWorkspaceGitStatus } from "../composables/useWorkspaceGitStatus.js";
import { useApi } from "../composables/useApi.js";
import { emit } from "../app-bridge.js";
import GitActionBtn from "./GitActionBtn.vue";
import { CWD_POLL_INTERVAL_MS } from "../utils/constants.js";
import { terminalSessionCwdPath } from "../utils/endpoints.js";

const { gitAction, isRunning } = useGitRemoteAction();
const { isMobile } = useIsMobile();
const { apiGet } = useApi();
const currentCwd = ref("");
const showJobsFiles = ref(true);
const navGroupEl = ref(null);

let cwdTimer = null;
let roNavGroup = null;
let navGroupTimer = null;

async function fetchCwd() {
  const tab = activeTab.value;
  if (!tab?.sessionId || isGitRepo.value) return currentCwd.value;
  const { ok, data } = await apiGet(terminalSessionCwdPath(tab.sessionId));
  if (ok) currentCwd.value = data?.cwd || "";
  return currentCwd.value;
}

function startPolling() {
  stopPolling();
  cwdTimer = setInterval(() => {
    if (document.hidden) return;
    fetchCwd();
  }, CWD_POLL_INTERVAL_MS);
}

function stopPolling() {
  if (cwdTimer) { clearInterval(cwdTimer); cwdTimer = null; }
}

// status-nav-group を観測する（Jobs/Files の表示切替で幅が変わらない安定した要素）。
// History ボタン自体を観測するとJobs/Files 表示切替 → ボタン幅変化 → 再切替のループが起きる。
watch(navGroupEl, (el) => {
  roNavGroup?.disconnect();
  roNavGroup = null;
  if (navGroupTimer) { clearTimeout(navGroupTimer); navGroupTimer = null; }
  if (!el) return;
  roNavGroup = new ResizeObserver((entries) => {
    for (const e of entries) {
      const w = e.contentRect.width;
      if (navGroupTimer) { clearTimeout(navGroupTimer); navGroupTimer = null; }
      navGroupTimer = setTimeout(() => {
        if (w < 230) showJobsFiles.value = false;
        else if (w > 280) showJobsFiles.value = true;
      }, 80);
    }
  });
  roNavGroup.observe(el);
});

onMounted(() => { startPolling(); });
onBeforeUnmount(() => {
  stopPolling();
  roNavGroup?.disconnect();
  if (navGroupTimer) { clearTimeout(navGroupTimer); navGroupTimer = null; }
});

const workspaceStore = useWorkspaceStore();
const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const activeTab = computed(() =>
  terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId),
);
const hasVisibleTabs = computed(() => terminalStore.openTabs.length > 0);
const workspace = computed(() => hasVisibleTabs.value ? (activeTab.value?.workspace || null) : null);
const showHeader = computed(() => !layoutStore.isSplitMode && hasVisibleTabs.value);

const ws = computed(() =>
  workspaceStore.allWorkspaces.find((w) => w.name === workspace.value),
);

const {
  isGitRepo,
  hasUpstream,
  hasRemoteBranch,
  ahead,
  behind,
  hasGitActions,
  isDirty,
  statusLoading,
  branchParts,
  isBranchLong,
  msgText,
  changedFiles,
  insertions,
  deletions,
} = useWorkspaceGitStatus(ws, isMobile);
const isPlainTerminal = computed(() => hasVisibleTabs.value && !isGitRepo.value);

// git リポジトリでないターミナル（素のターミナル含む）では、登録ボタンに現在の
// ディレクトリ名を表示する。cwd はセッションから取得する。
watch(
  () => [activeTab.value?.sessionId, isGitRepo.value],
  async ([sessionId, gitRepo]) => {
    currentCwd.value = "";
    if (!sessionId || gitRepo) return;
    await fetchCwd();
  },
  { immediate: true },
);

function cwdBaseName(path) {
  return path.split("/").filter(Boolean).pop() || path;
}

const matchingWorkspace = computed(() => {
  if (!currentCwd.value) return null;
  return workspaceStore.allWorkspaces.find((w) => w.path === currentCwd.value) || null;
});

const addLabel = computed(() => {
  if (matchingWorkspace.value) {
    return `Open "${matchingWorkspace.value.name}" workspace`;
  }
  if (!currentCwd.value) return "Open a workspace";
  return `Add "${cwdBaseName(currentCwd.value)}" workspace`;
});

async function openFileModal(pane = "files") {
  if (!isGitRepo.value && pane !== "files") return;
  if (workspace.value) {
    workspaceStore.selectedWorkspace = workspace.value;
  }
  const detail = { pane };
  if (!isGitRepo.value && activeTab.value?.sessionId) {
    await fetchCwd();
    detail.terminalSessionId = activeTab.value.sessionId;
    detail.rootLabel = currentCwd.value ? cwdBaseName(currentCwd.value) : "terminal";
  }
  emit("git:openFileModal", detail);
}

function doAction(action) {
  const wsName = workspace.value;
  if (!wsName) return;
  const branch = ws.value?.branch || "";
  gitAction(wsName, action, { branch });
}

async function registerCurrentDir() {
  const tab = activeTab.value;
  if (!tab?.sessionId) return;
  // cwd が不明な場合はワークスペース選択モーダルを開くだけにする。
  if (!currentCwd.value) {
    emit("workspace:openModal");
    return;
  }
  // 最新の cwd を取りに行く（watch 取得後に cd された場合に備える）。
  let cwd = currentCwd.value;
  try {
    const { ok, data } = await apiGet(terminalSessionCwdPath(tab.sessionId));
    if (ok && data?.cwd) cwd = data.cwd;
  } catch { /* フェッチ失敗時は既存の cwd で続行 */ }

  // CWD が既存ワークスペースのパスと一致する場合はそのワークスペースで開き直す。
  const existing = workspaceStore.allWorkspaces.find((w) => w.path === cwd);
  if (existing) {
    emit("terminal:launch", {
      workspace: existing.name,
      icon: existing.icon,
      iconColor: existing.icon_color,
    });
    return;
  }

  // ワークスペース追加画面を cwd 入力済みで開く。追加後は発火元タブに紐付ける。
  emit("workspace:openAdd", {
    initialPath: cwd || "",
    attachSessionId: tab.sessionId,
    attachTabId: tab.id,
  });
}

</script>

<style scoped>
.workspace-status-bar {
  display: none;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 4px 8px 6px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
}

.status-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 2px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  white-space: nowrap;
  color: var(--text-primary);
}

.status-nav-group {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 0;
}

.status-divider {
  width: 1px;
  height: 26px;
  background: color-mix(in srgb, var(--text-muted) 50%, var(--border));
  flex-shrink: 0;
}

.status-btn-icon {
  font-size: 15px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.status-btn-label {
  font-size: 12px;
color: #ffffff;
  display: none;
}

/* Placeholder や読み込み中の例外は既存のクラスで上書きされる */
.status-placeholder-btn .status-btn-label,
.status-msg-loading + .status-btn-label {
  color: var(--text-muted);
}

.status-btn-label-always {
  display: inline;
}

.status-nav-btn:has(.status-btn-label-always) {
  padding: 0 8px;
}

.status-add-workspace-btn {
  max-width: 100%;
  min-width: 0;
}

.status-add-workspace-btn .status-btn-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-placeholder-btn {
  cursor: default;
  color: var(--text-muted);
  opacity: 0.55;
}

@media (hover: hover) and (pointer: fine) {
  .status-btn-label {
    display: inline;
  }

  .status-nav-btn {
    padding: 0 8px;
  }

  .status-msg-btn .status-btn-label {
    display: none;
  }
}


.status-branch-btn {
  flex-shrink: 1;
  min-width: 0;
  max-width: 60%;
  gap: 4px;
  padding-left: 8px;
  color: var(--text-primary);
}

@media (hover: hover) and (pointer: fine) {
  .status-branch-btn {
    max-width: none;
    flex-shrink: 0;
  }
}


.status-branch-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.branch-abbr {
  color: var(--accent);
  font-weight: 500;
}

.status-msg-btn {
  flex: 1;
  min-width: 0;
  gap: 4px;
  padding-left: 8px;
  justify-content: flex-start;
}

.status-msg-text {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  user-select: none;
  -webkit-user-select: none;
}

.status-msg-loading {
  color: var(--text-muted);
}

.status-msg-loading::after {
  content: "";
  animation: loading-dots 1.2s steps(4) infinite;
}

@keyframes loading-dots {
  0% { content: ""; }
  25% { content: "."; }
  50% { content: ".."; }
  75% { content: "..."; }
}

.status-numstat-btn {
  flex-shrink: 0;
  gap: 6px;
  padding-left: 8px;
  padding-right: 8px;
  justify-content: flex-start;
}

.numstat-files {
  color: var(--warning);
}

.git-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .status-nav-btn:not(:disabled):hover {
    background: var(--bg-secondary);
  }
}


</style>
