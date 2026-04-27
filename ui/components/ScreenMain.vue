<template>
  <div v-if="booting || isEmptyScreenVisible" class="output-container screen-main-empty">
    <ScreenEmpty :booting="booting" :boot-message="bootMessage" @openWorkspace="openWorkspaceSelection" />
  </div>
  <div v-else class="main-panel" :class="{ 'panel-bottom': isPanelBottom }">
    <TabBar v-show="!isTextInputVisible" ref="tabBarView" :tabs="openTabs" />
    <WorkspaceStatusBar v-show="!isTextInputVisible" />
    <TerminalBase
      ref="terminalBaseView"
      :is-panel-bottom="isPanelBottom"
      @keyboard-input-visibility="updateKeyboardInputVisibility"
    />
  </div>
  <Modal />
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import WorkspaceStatusBar from "./WorkspaceStatusBar.vue";
import TabBar from "./TabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import ScreenEmpty from "./ScreenEmpty.vue";
import Modal from "./Modal.vue";
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
import { on, emit } from "../app-bridge.js";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES, EP_RUN } from "../utils/endpoints.js";

const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();
const { disconnectTerminal, deleteSession, connectDeferredTabs, connectTerminalWs } = useTerminal();
const { sendTextToTerminal } = useKeyboard();
const { initViewport } = useViewport();
const { confirm } = useConfirm();
const { restoreExistingSessions, syncSessionsFromServer, startSyncPolling, stopSyncPolling } = useSessionSync();
const { loadSnippetCache, moveSnippetToFront, addSnippet, deleteSnippet } = useSnippetPersist();

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

  const [, sessionsRes, jobsRes] = await Promise.all([workspacesPromise, sessionsPromise, jobsPromise]);

  bootMessage.value = "Restoring sessions...";
  await restoreExistingSessions(sessionsRes, jobsRes);

  workspaceStore.fetchStatuses();
}


const openTabs = computed(() => terminalStore.openTabs);
const isEmptyScreenVisible = computed(() => openTabs.value.length === 0 && !layoutStore.isSplitMode);

const tabBarView = ref(null);
const terminalBaseView = ref(null);
const isTextInputVisible = ref(false);

const isPanelBottom = computed(() => layoutStore.isPanelBottom);

let mainPanelResizeObserver = null;
let resizeFitTimerId = null;

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
    const targetId = ids[paneIndex] || ids[0];
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
        job: "terminal",
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
    layoutStore.splitPaneTabIds = layoutStore.splitPaneTabIds.filter((id) => id !== tabId);
    if (layoutStore.splitPaneTabIds.length < 2) {
      layoutStore.exitSplitMode();
    }
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

  bridgeCleanups.push(on("terminal:launch", (detail) => {
    launchTerminal(detail);
  }));

  bridgeCleanups.push(on("snippet:tap", ({ command }) => {
    sendTextToTerminal(command + "\n");
    moveSnippetToFront(command);
  }));

  bridgeCleanups.push(on("snippet:reorder", ({ command }) => {
    moveSnippetToFront(command);
  }));

  bridgeCleanups.push(on("snippet:add", ({ label, command }) => addSnippet(label, command)));
  bridgeCleanups.push(on("snippet:delete", ({ index }) => deleteSnippet(index)));

  loadSnippetCache();

  bridgeCleanups.push(on("keyboard:activate", () => {
    ensureKeyboardTargetTab();
    terminalBaseView.value?.showKeyboardInput?.();
  }));

  bridgeCleanups.push(on("keyboard:deactivate", () => {
    terminalBaseView.value?.hideKeyboardInput?.();
  }));

  initViewport(() => {
    terminalBaseView.value?.fitAllTerminals();
  });

  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("keydown", onGlobalKeydown, true);

  if (typeof ResizeObserver !== "undefined") {
    mainPanelResizeObserver = new ResizeObserver(() => {
      if (resizeFitTimerId) clearTimeout(resizeFitTimerId);
      resizeFitTimerId = setTimeout(() => {
        resizeFitTimerId = null;
        terminalBaseView.value?.fitAllTerminals();
      }, 50);
    });
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


function onVisibilityChange() {
  if (document.hidden) {
    stopSyncPolling();
    return;
  }
  for (const tab of terminalStore.openTabs) {
    tab._lastFitCols = 0;
    tab._lastFitRows = 0;
    if (tab.ws) {
      clearTimeout(tab._reconnectTimer);
      try { tab.ws.onclose = null; tab.ws.close(); } catch {}
      tab.ws = null;
    }
    tab._pendingRedraw = true;
    tab._reconnectAttempts = 0;
  }

  syncSessionsFromServer().then(() => {
    const visibleTabIds = new Set();
    if (layoutStore.isSplitMode) {
      for (const id of layoutStore.splitPaneTabIds || []) {
        if (id != null) visibleTabIds.add(id);
      }
    } else if (terminalStore.activeTabId != null) {
      visibleTabIds.add(terminalStore.activeTabId);
    }
    for (const tab of terminalStore.openTabs) {
      if (!visibleTabIds.has(tab.id)) continue;
      if (tab._pendingRedraw && !tab.ws && !tab._wsDisposed) {
        connectTerminalWs(tab);
      }
    }
    terminalBaseView.value?.fitAllTerminals({ force: true });
    startSyncPolling();
  });
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
  document.removeEventListener("keydown", onGlobalKeydown, true);
});

function updateKeyboardInputVisibility(visible) {
  isTextInputVisible.value = !!visible;
}

defineExpose({
  tabBar: tabBarView,
  terminalSplit: terminalBaseView,
});
</script>

<style scoped>
.screen-main-empty {
  height: var(--app-dvh);
  min-height: var(--app-dvh);
  align-items: stretch;
}

.main-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.main-panel.panel-bottom :deep(.output-container) {
  order: -1;
}

.main-panel.panel-bottom :deep(.tab-bar-row) {
  order: 2;
  position: relative;
  border-bottom: none;
  border-top: 1px solid var(--border);
  padding-bottom: 4px;
}

.main-panel.panel-bottom :deep(.tab-bar) {
  padding: 0 8px 4px;
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

.main-panel.keyboard-open :deep(.tab-bar-row),
.main-panel.keyboard-open :deep(.workspace-status-bar) {
  display: none !important;
}

:global(.pwa .main-panel.panel-bottom .tab-bar) {
  padding-bottom: 0;
}

:global(.pwa .main-panel.panel-bottom .tab-bar-row) {
  padding-bottom: 28px;
}
</style>
