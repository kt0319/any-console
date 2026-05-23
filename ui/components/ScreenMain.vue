<template>
  <div class="main-panel" :class="{ 'panel-bottom': isPanelBottom, 'split-mode': isSplitMode }">
    <TabBar ref="tabBarView" :tabs="openTabs" />
    <div v-if="!isSplitMode" class="active-tab-title">
      <template v-if="debugMode">
        <span :class="['active-tab-debug', latestLog ? `debug-level-${latestLog.level}` : '']">{{ debugInfo }}</span>
      </template>
      <span v-else>{{ activeTabLabel || ' ' }}</span>
    </div>
    <WorkspaceStatusBar />
    <div v-if="booting || isEmptyScreenVisible" class="screen-main-empty">
      <ScreenEmpty :booting="booting" :boot-message="bootMessage" @openWorkspace="openWorkspaceSelection" />
    </div>
    <TerminalBase
      v-else
      ref="terminalBaseView"
      :is-panel-bottom="isPanelBottom"
    >
      <StatusOverlay :visible="isOffline" label="Connection lost" variant="error" />
    </TerminalBase>

  </div>
  <Modal />
  <TerminalSelectModal />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import WorkspaceStatusBar from "./WorkspaceStatusBar.vue";
import TabBar from "./TabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import ScreenEmpty from "./ScreenEmpty.vue";
import Modal from "./Modal.vue";
import TerminalSelectModal from "./TerminalSelectModal.vue";
import StatusOverlay from "./StatusOverlay.vue";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminal } from "../composables/useTerminal.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useViewport } from "../composables/useViewport.js";
import { useSessionSync } from "../composables/useSessionSync.js";
import { useSnippetPersist } from "../composables/useSnippetPersist.js";
import { useDebugMode } from "../composables/useDebugMode.js";
import { useClientLogs } from "../composables/useClientLogs.js";
import { on, emit } from "../app-bridge.js";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES, EP_RUN, EP_SETTINGS_CONFIG_HEALTH } from "../utils/endpoints.js";
import { TERMINAL_JOB_KEY } from "../utils/constants.js";

const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const { isOffline } = useConnectivityMonitor();
const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const { disconnectTerminal, deleteSession, connectDeferredTabs, connectTerminalWs } = useTerminal();
const { sendTextToTerminal } = useKeyboard();
const { initViewport } = useViewport();
const { confirm } = useConfirm();
const { restoreExistingSessions, syncSessionsFromServer, startSyncPolling, stopSyncPolling } = useSessionSync();
const { loadSnippetCache, moveSnippetToFront, addSnippet, deleteSnippet, moveSnippet } = useSnippetPersist();

const booting = ref(true);
const bootMessage = ref("Loading...");

async function initializeApp() {
  bootMessage.value = "Loading...";

  const workspacesPromise = workspaceStore.fetchWorkspaces().then(() => {
    if (!workspaceStore.selectedWorkspace) {
      const first = workspaceStore.visibleWorkspaces[0];
      if (first) workspaceStore.selectedWorkspace = first.name;
    }
  }).catch((e) => console.error("workspaces fetch failed:", e));

  const sessionsPromise = auth.apiFetch(EP_TERMINAL_SESSIONS).catch(() => null);
  const jobsPromise = auth.apiFetch(EP_JOBS_WORKSPACES).catch(() => null);
  const healthPromise = auth.apiFetch(EP_SETTINGS_CONFIG_HEALTH).catch(() => null);

  const [, sessionsRes, jobsRes, healthRes] = await Promise.all([workspacesPromise, sessionsPromise, jobsPromise, healthPromise]);

  if (healthRes?.ok) {
    const health = await healthRes.json();
    if (!health.ok) {
      const msg = health.source === "config.bak"
        ? "Config was restored from backup. Some settings may be missing."
        : `Config has validation errors: ${health.errors.map((e) => e.key).join(", ")}`;
      emit("toast:show", { message: msg, type: "warning" });
    }
  }

  bootMessage.value = "Restoring sessions...";
  await restoreExistingSessions(sessionsRes, jobsRes);

  workspaceStore.fetchStatuses();
}


const openTabs = computed(() => terminalStore.openTabs);
const isEmptyScreenVisible = computed(() => openTabs.value.length === 0 && !layoutStore.isSplitMode);
const activeTabLabel = computed(() => {
  const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
  if (!tab) return "";
  const ws = tab.workspace || "";
  const job = tab.jobLabel || tab.jobName || "";
  return [ws, job].filter(Boolean).join(" / ");
});

const debugMode = useDebugMode();
const { logs: clientLogs, levelLabel } = useClientLogs();

const latestLog = computed(() => clientLogs.value[clientLogs.value.length - 1] || null);
const debugInfo = computed(() => {
  const log = latestLog.value;
  if (!log) return "(no logs yet)";
  const t = new Date(log.time).toTimeString().slice(0, 8);
  // 既定の "log" レベルは冗長なので非表示。warn/error/info のみラベル表示。
  const label = log.level === "log" ? "" : `[${levelLabel(log.level)}] `;
  return `${t} ${label}${log.msg}`;
});

const tabBarView = ref(null);
const terminalBaseView = ref(null);

const isPanelBottom = computed(() => layoutStore.isPanelBottom);
const isSplitMode = computed(() => layoutStore.isSplitMode);

let mainPanelResizeObserver = null;

function openWorkspaceSelection() {
  emit("workspace:openModal");
}

function focusTabTerminal(tabId) {
  const tab = terminalStore.openTabs.find((t) => t.id === tabId);
  if (!tab?.term) return;
  requestAnimationFrame(() => {
    try {
      tab.term.focus();
    } catch {}
  });
}

function activateTerminalTab(tabId, { focus = true } = {}) {
  terminalStore.switchTab(tabId);

  if (layoutStore.isSplitMode) {
    const existingPaneIndex = layoutStore.splitPaneTabIds.indexOf(tabId);
    if (existingPaneIndex >= 0) {
      layoutStore.activePaneIndex = existingPaneIndex;
    } else {
      const nextPaneTabIds = [...layoutStore.splitPaneTabIds];
      const targetPaneIndex = Math.max(0, Math.min(layoutStore.activePaneIndex || 0, nextPaneTabIds.length));
      if (nextPaneTabIds.length === 0) {
        nextPaneTabIds.push(tabId);
      } else if (targetPaneIndex < nextPaneTabIds.length) {
        nextPaneTabIds[targetPaneIndex] = tabId;
      } else {
        nextPaneTabIds.push(tabId);
      }
      layoutStore.splitPaneTabIds = nextPaneTabIds;
      layoutStore.activePaneIndex = nextPaneTabIds.indexOf(tabId);
    }
  }

  if (focus) focusTabTerminal(tabId);
}

function ensureKeyboardTargetTab() {
  if (terminalStore.openTabs.length === 0) return;
  const hasActive = terminalStore.openTabs.some((t) => t.id === terminalStore.activeTabId);
  if (hasActive) return;

  if (layoutStore.isSplitMode) {
    const ids = layoutStore.splitPaneTabIds || [];
    const paneIndex = layoutStore.activePaneIndex || 0;
    const isReal = (id) => id != null && !layoutStore.isEmptyPaneId(id);
    const targetId = isReal(ids[paneIndex]) ? ids[paneIndex] : ids.find(isReal);
    if (targetId) {
      terminalStore.switchTab(targetId);
      focusTabTerminal(targetId);
      return;
    }
  }

  const visibleTabs = terminalStore.openTabs.filter((t) => !t.hidden);
  const firstId = (visibleTabs[0] || terminalStore.openTabs[0]).id;
  terminalStore.switchTab(firstId);
  focusTabTerminal(firstId);
}

async function launchTerminal({ workspace, icon, iconColor, jobName, jobLabel, jobIcon, jobIconColor, initialCommand, hidden }) {
  try {
    const res = await auth.apiFetch(EP_RUN, {
      method: "POST",
      body: {
        job: TERMINAL_JOB_KEY,
        workspace: workspace || null,
        icon: icon || null,
        icon_color: iconColor || null,
        job_name: jobName || null,
        job_label: jobLabel || null,
      },
    });
    if (!res || !res.ok) {
      const detail = res ? await res.text() : "no response";
      emit("toast:show", { message: `Terminal launch failed: ${detail}`, type: "error" });
      return;
    }
    const data = await res.json();
    const tab = terminalStore.addTerminalTab({
      wsUrl: data.ws_url,
      workspace,
      wsIcon: icon,
      wsIconColor: iconColor,
      icon: jobName ? (jobIcon || "mdi-play") : "mdi-console",
      iconColor: jobIconColor,
      jobName,
      jobLabel,
      initialCommand,
      hidden,
    });
    activateTerminalTab(tab.id, { focus: false });
    if (workspace) workspaceStore.selectedWorkspace = workspace;
    await nextTick();
    terminalBaseView.value?.fitAllTerminals();
    activateTerminalTab(tab.id);
  } catch (e) {
    emit("toast:show", { message: `Terminal launch error: ${e.message}`, type: "error" });
  }
}

function refreshTab(tab) {
  const tabObj = terminalStore.openTabs.find((t) => t.id === tab.id);
  if (!tabObj) return;
  // 現在の WebSocket を切ってから再接続。tmux session は維持する。
  if (tabObj.ws) {
    try { tabObj.ws.onclose = null; tabObj.ws.close(); } catch {}
    tabObj.ws = null;
  }
  clearTimeout(tabObj._reconnectTimer);
  tabObj._reconnectAttempts = 0;
  // xterm.js のバッファを完全にクリアして tmux capture-pane で screen を取り直す。
  // term.refresh() だけだと崩れたバッファをそのまま再描画してしまうため。
  try { tabObj.term?.reset(); } catch {}
  tabObj._needsHistoryRestore = true;
  tabObj._pendingRedraw = true;
  connectTerminalWs(tabObj, {
    focus: false,
    onOpen: () => {
      terminalBaseView.value?.fitAllTerminals({ force: true });
    },
  });
}

async function closeTab(tab) {
  const tabId = tab.id;
  const sessionId = tab.sessionId;
  const tabObj = terminalStore.openTabs.find((t) => t.id === tabId);
  if (tabObj) {
    disconnectTerminal(tabObj);
    if (tabObj.term) tabObj.term.dispose();
  }
  terminalStore.removeTab(tabId);
  if (layoutStore.isSplitMode) {
    layoutStore.replaceTabWithEmpty(tabId);
  }
  if (sessionId) {
    await deleteSession(sessionId);
  }
}

const bridgeCleanups = [];

onMounted(() => {
  bridgeCleanups.push(on("layout:fitAll", (detail) => {
    connectDeferredTabs();
    terminalBaseView.value?.fitAllTerminals(detail);
  }));

  bridgeCleanups.push(on("tab:select", ({ tab }) => {
    activateTerminalTab(tab.id);
    if (tab.workspace) {
      workspaceStore.selectedWorkspace = tab.workspace;
    }
  }));

  bridgeCleanups.push(on("tab:close", ({ tab }) => {
    closeTab(tab);
    const activeTab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
    workspaceStore.selectedWorkspace = activeTab?.workspace || null;
  }));

  bridgeCleanups.push(on("tab:refresh", ({ tab }) => {
    refreshTab(tab);
  }));

  bridgeCleanups.push(on("terminal:launch", (detail) => {
    launchTerminal(detail);
  }));

  bridgeCleanups.push(on("snippet:tap", ({ command }) => {
    sendTextToTerminal(command);
    moveSnippetToFront(command);
  }));

  bridgeCleanups.push(on("snippet:reorder", ({ command }) => {
    moveSnippetToFront(command);
  }));

  bridgeCleanups.push(on("snippet:add", ({ label, command }) => addSnippet(label, command)));
  bridgeCleanups.push(on("snippet:delete", ({ index }) => deleteSnippet(index)));
  bridgeCleanups.push(on("snippet:move", ({ from, to }) => moveSnippet(from, to)));

  loadSnippetCache();

  bridgeCleanups.push(on("keyboard:activate", () => {
    ensureKeyboardTargetTab();
  }));

  initViewport(() => {
    terminalBaseView.value?.fitAllTerminals();
  });

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("keydown", onGlobalKeydown, true);

  if (typeof ResizeObserver !== "undefined") {
    mainPanelResizeObserver = new ResizeObserver(() => {});
    const main = document.querySelector(".main-panel");
    if (main) mainPanelResizeObserver.observe(main);
  }
});

onMounted(async () => {
  booting.value = true;
  bootMessage.value = "Initializing...";
  try {
    await initializeApp();
    startSyncPolling();
  } finally {
    booting.value = false;
    bootMessage.value = "Loading...";
  }
});


let resumeDebounceTimer = null;
let wasHidden = false;

function scheduleResume() {
  if (document.hidden) return;
  if (resumeDebounceTimer) return;
  resumeDebounceTimer = setTimeout(() => {
    resumeDebounceTimer = null;
    handleResume();
  }, 100);
}

function handleResume() {
  for (const tab of terminalStore.openTabs) {
    if (tab.ws) {
      clearTimeout(tab._reconnectTimer);
      try { tab.ws.onclose = null; tab.ws.close(); } catch {}
      tab.ws = null;
    }
    tab._pendingRedraw = true;
    tab._reconnectAttempts = 0;
    terminalStore.setTabFlag(tab.id, "reconnecting", true);
  }

  syncSessionsFromServer().then(() => {
    const visibleTabIds = new Set();
    if (layoutStore.isSplitMode) {
      for (const id of layoutStore.splitPaneTabIds || []) {
        if (id != null && !layoutStore.isEmptyPaneId(id)) visibleTabIds.add(id);
      }
    } else if (terminalStore.activeTabId != null) {
      visibleTabIds.add(terminalStore.activeTabId);
    }
    for (const tab of terminalStore.openTabs) {
      if (!visibleTabIds.has(tab.id)) continue;
      if (tab._pendingRedraw && !tab.ws && !tab._wsDisposed) {
        connectTerminalWs(tab, { focus: false });
      }
    }
    terminalBaseView.value?.fitAllTerminals();
    startSyncPolling();
  });
}

function onVisibilityChange() {
  if (document.hidden) {
    wasHidden = true;
    stopSyncPolling();
    return;
  }
  if (!wasHidden) return;
  wasHidden = false;
  scheduleResume();
}

function onPageShow(e) {
  if (!e.persisted) return;
  wasHidden = false;
  scheduleResume();
}

async function onGlobalKeydown(e) {
  if (!e.metaKey || !e.shiftKey || e.ctrlKey || e.altKey) return;
  if (e.code === "KeyW") {
    const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
    if (!tab) return;
    e.preventDefault();
    const label = tab.workspace || tab.label || "terminal";
    if (await confirm(`Close "${label}" tab?`)) {
      closeTab(tab);
      const activeTab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
      workspaceStore.selectedWorkspace = activeTab?.workspace || null;
    }
  } else if (e.code === "KeyN") {
    e.preventDefault();
    emit("workspace:openModal");
  } else if (e.code === "KeyT") {
    e.preventDefault();
    emit("settings:open", { view: "TabConfig" });
  } else if (e.code === "Period") {
    e.preventDefault();
    emit("settings:open");
  }
}

onBeforeUnmount(() => {
  bridgeCleanups.forEach((cleanup) => cleanup());
  stopSyncPolling();
  mainPanelResizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pageshow", onPageShow);
  document.removeEventListener("keydown", onGlobalKeydown, true);
  if (resumeDebounceTimer) {
    clearTimeout(resumeDebounceTimer);
    resumeDebounceTimer = null;
  }
});

defineExpose({
  tabBar: tabBarView,
  terminalSplit: terminalBaseView,
});
</script>

<style scoped>
.screen-main-empty {
  flex: 1;
  min-height: 0;
  display: flex;
}

.active-tab-title {
  display: none;
  flex-shrink: 0;
  align-items: flex-end;
  justify-content: center;
  min-height: 32px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
  padding: 4px 12px 6px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-tab-title > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.active-tab-debug {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, "Menlo", "Consolas", monospace;
  font-size: 12px;
  color: var(--text-secondary);
}

.debug-level-warn { color: var(--warning); }
.debug-level-error { color: var(--error); }
.debug-level-info { color: var(--accent); }

@media (max-width: 768px) {
  .active-tab-title {
    display: flex;
  }
}

.main-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.main-panel.panel-bottom :deep(.output-container) {
  order: -1;
}

.main-panel.panel-bottom :deep(.tab-bar-row) {
  order: 2;
  position: relative;
  border-bottom: none;
  border-top: 1px solid var(--border);
  padding-bottom: 0;
}

.main-panel.panel-bottom :deep(.tab-bar) {
  padding: 0 8px;
}

.main-panel.panel-bottom :deep(.tab-btn) {
  border-radius: 0 0 6px 6px;
  padding: 6px 12px;
  gap: 2px;
  min-width: 80px;
  justify-content: center;
}

.main-panel.panel-bottom :deep(.workspace-status-bar) {
  order: 1;
  border-bottom: none;
  border-top: 1px solid var(--border);
}

.main-panel.panel-bottom .active-tab-title {
  order: 3;
  border: none;
  padding: 0 12px;
  padding-bottom: env(safe-area-inset-bottom);
}

.main-panel.keyboard-open :deep(.tab-bar-row),
.main-panel.keyboard-open :deep(.workspace-status-bar),
.main-panel.keyboard-open .active-tab-title {
  display: none !important;
}

:global(.pwa .main-panel.panel-bottom .tab-bar) {
  padding-bottom: 0;
}

:global(.pwa .main-panel.panel-bottom .tab-bar-row) {
  padding-bottom: 0;
}

:global(.pwa .main-panel.panel-bottom .active-tab-title) {
  padding-bottom: calc(env(safe-area-inset-bottom) + 14px);
}
</style>
