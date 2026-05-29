<template>
  <div class="main-panel" :class="{ 'panel-bottom': isPanelBottom, 'split-mode': isSplitMode, 'keyboard-open': keyboardOpen }">
    <TabBar ref="tabBarView" :tabs="openTabs" />
    <div class="active-tab-title">
      <template v-if="debugMode">
        <span :class="['active-tab-debug', latestLog ? `debug-level-${latestLog.level}` : '']">{{ debugInfo }}</span>
      </template>
      <span v-else>{{ activeTabLabel || ' ' }}</span>
    </div>
    <WorkspaceStatusBar v-show="!booting" />
    <DashboardPane
      v-if="isDashboardVisible && !dashboardError"
      ref="dashboardPaneView"
      :booting="booting"
      :boot-message="bootMessage"
    />
    <div v-else-if="isDashboardVisible && dashboardError" class="screen-main-empty dashboard-error-state">
      <span class="mdi mdi-alert-circle-outline dashboard-error-icon"></span>
      <span class="dashboard-error-msg">{{ dashboardError }}</span>
      <button class="dashboard-error-reload" @click="dashboardError = null">Retry</button>
    </div>
    <div v-else-if="booting || isEmptyScreenVisible" class="screen-main-empty">
      <ScreenEmpty :booting="booting" :boot-message="bootMessage" @openWorkspace="openWorkspaceSelection" />
    </div>
    <TerminalBase
      v-if="hasAnyTab && !booting"
      v-show="!isDashboardVisible && !isEmptyScreenVisible"
      ref="terminalBaseView"
      :is-panel-bottom="isPanelBottom"
    >
      <StatusOverlay :visible="isOffline" label="Connection lost" variant="error" />
    </TerminalBase>
    <KeyboardBar :is-panel-bottom="isPanelBottom" />

  </div>
  <Modal />
  <TerminalSelectModal />
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, onErrorCaptured } from "vue";
import WorkspaceStatusBar from "./WorkspaceStatusBar.vue";
import TabBar from "./TabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import KeyboardBar from "./KeyboardBar.vue";
import ScreenEmpty from "./ScreenEmpty.vue";
import DashboardPane from "./DashboardPane.vue";
import Modal from "./Modal.vue";
import TerminalSelectModal from "./TerminalSelectModal.vue";
import StatusOverlay from "./StatusOverlay.vue";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminal } from "../composables/useTerminal.js";
import { useKeyboard } from "../composables/useKeyboard.js";
import { useViewport } from "../composables/useViewport.js";
import { useSessionSync } from "../composables/useSessionSync.js";
import { useSnippetPersist } from "../composables/useSnippetPersist.js";
import { useDebugMode, useDebugLevels } from "../composables/useDebugMode.js";
import { useClientLogs } from "../composables/useClientLogs.js";
import { useAppBootstrap } from "../composables/useAppBootstrap.js";
import { useTerminalLifecycle } from "../composables/useTerminalLifecycle.js";
import { useSessionResume } from "../composables/useSessionResume.js";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts.js";
import { on, emit } from "../app-bridge.js";

const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const { isOffline } = useConnectivityMonitor();
const workspaceStore = useWorkspaceStore();
const { connectDeferredTabs } = useTerminal();
const { sendTextToTerminal } = useKeyboard();
const { initViewport } = useViewport();
const keyboardOpen = ref(false);
const { startSyncPolling, stopSyncPolling } = useSessionSync();
const { loadSnippetCache, moveSnippetToFront, addSnippet, deleteSnippet, moveSnippet } = useSnippetPersist();

const tabBarView = ref(null);
const terminalBaseView = ref(null);
const dashboardPaneView = ref(null);
const dashboardError = ref(null);

onErrorCaptured((err) => {
  if (isDashboardVisible.value) {
    dashboardError.value = err?.message || String(err);
    return false;
  }
});

const { booting, bootMessage, initializeApp } = useAppBootstrap();
const {
  activateTerminalTab,
  ensureKeyboardTargetTab,
  launchTerminal,
  refreshTab,
  closeTab,
} = useTerminalLifecycle({ terminalBaseView });

useSessionResume({ terminalBaseView });
useGlobalShortcuts({ closeTab });

const openTabs = computed(() => terminalStore.openTabs);
const hasAnyTab = computed(() => openTabs.value.length > 0);
const hasVisibleTab = computed(() => openTabs.value.some((t) => !t.hidden));
const isEmptyScreenVisible = computed(() => {
  if (layoutStore.isSplitMode) return false;
  if (hasVisibleTab.value) return false;
  return !openTabs.value.some(t => t.id === terminalStore.activeTabId);
});

watch(isEmptyScreenVisible, async (isEmpty) => {
  if (!isEmpty) {
    await nextTick();
    requestAnimationFrame(() => terminalBaseView.value?.fitAllTerminals());
  }
});

const activeTabLabel = computed(() => {
  if (isEmptyScreenVisible.value) return "";
  let tabId = terminalStore.activeTabId;
  if (layoutStore.isSplitMode) {
    const paneId = layoutStore.splitPaneTabIds[layoutStore.activePaneIndex];
    if (paneId != null && !layoutStore.isEmptyPaneId(paneId)) tabId = paneId;
  }
  const tab = terminalStore.openTabs.find((t) => t.id === tabId);
  if (!tab) return "";
  const ws = tab.workspace || "";
  const job = tab.jobLabel || tab.jobName || "";
  const label = [ws, job].filter(Boolean).join(" / ");
  return layoutStore.isSplitMode ? `[split] ${label}` : label;
});

const debugMode = useDebugMode();
const { logs: clientLogs, levelLabel } = useClientLogs();
const debugLevels = useDebugLevels();

const latestLog = computed(() => {
  for (let i = clientLogs.value.length - 1; i >= 0; i--) {
    if (debugLevels.value.has(clientLogs.value[i].level)) return clientLogs.value[i];
  }
  return null;
});
const debugInfo = computed(() => {
  const log = latestLog.value;
  if (!log) return "(no logs yet)";
  const label = log.level === "log" ? "" : `[${levelLabel(log.level)}] `;
  return `${label}${log.msg}`;
});

const isPanelBottom = computed(() => layoutStore.isPanelBottom);
const isSplitMode = computed(() => layoutStore.isSplitMode);
const isDashboardVisible = computed(() => layoutStore.dashboardActive && !isSplitMode.value);

watch(isDashboardVisible, async (visible) => {
  if (!visible) {
    await nextTick();
    requestAnimationFrame(() => terminalBaseView.value?.fitAllTerminals());
  }
});

let mainPanelResizeObserver = null;

function openWorkspaceSelection() {
  emit("workspace:openModal");
}

const bridgeCleanups = [];

onMounted(() => {
  bridgeCleanups.push(on("layout:fitAll", (detail) => {
    connectDeferredTabs();
    terminalBaseView.value?.fitAllTerminals(detail);
  }));

  bridgeCleanups.push(on("tab:select", ({ tab }) => {
    layoutStore.setDashboardActive(false);
    activateTerminalTab(tab.id);
    if (tab.workspace) {
      workspaceStore.selectedWorkspace = tab.workspace;
    }
  }));

  bridgeCleanups.push(on("tab:close", ({ tab }) => {
    closeTab(tab);
    const remainingTabs = terminalStore.openTabs.filter((t) => !t.hidden);
    if (remainingTabs.length === 0) {
      layoutStore.setDashboardActive(true);
    }
    const activeTab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
    workspaceStore.selectedWorkspace = activeTab?.workspace || null;
  }));

  bridgeCleanups.push(on("tab:refresh", ({ tab }) => {
    refreshTab(tab);
  }));

  bridgeCleanups.push(on("terminal:launch", (detail) => {
    layoutStore.setDashboardActive(false);
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

  bridgeCleanups.push(on("oskeyboard:show", () => { keyboardOpen.value = true; }));
  bridgeCleanups.push(on("oskeyboard:hide", () => { keyboardOpen.value = false; }));

  initViewport((opts) => {
    terminalBaseView.value?.fitAllTerminals(opts);
  });

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

onBeforeUnmount(() => {
  bridgeCleanups.forEach((cleanup) => cleanup());
  stopSyncPolling();
  mainPanelResizeObserver?.disconnect();
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

.dashboard-error-state {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
}

.dashboard-error-icon {
  font-size: 32px;
  color: var(--error);
}

.dashboard-error-msg {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  max-width: 360px;
  word-break: break-word;
}

.dashboard-error-reload {
  font-size: 12px;
  padding: 5px 14px;
  min-height: 0;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
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

.main-panel.split-mode .active-tab-title {
  display: flex;
}

@media (hover: hover) and (pointer: fine) {
  .main-panel.split-mode .active-tab-title {
    display: none;
  }

  .main-panel.split-mode :deep(.keyboard-bar) {
    display: none;
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

.main-panel.panel-bottom :deep(.keyboard-bar) {
  order: 0;
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
.main-panel.keyboard-open :deep(.workspace-status-bar) {
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
