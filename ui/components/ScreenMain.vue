<template>
  <div class="main-panel" :class="{ 'panel-bottom': isPanelBottom, 'split-mode': isSplitMode, 'keyboard-open': keyboardOpen }">
    <TabBar ref="tabBarView" :tabs="openTabs" />
    <div class="active-tab-title">
      <template v-if="debugMode">
        <span :class="['active-tab-debug', latestLog ? `debug-level-${latestLog.level}` : '']">{{ debugInfo }}</span>
      </template>
      <span v-else>{{ activeTabLabel || ' ' }}</span>
    </div>
    <WorkspaceStatusBar v-show="false" />
    <div class="content-area">
      <div v-if="booting || isEmptyScreenVisible" class="screen-main-empty">
        <ScreenEmpty :booting="booting" :boot-message="bootMessage" @openWorkspace="openWorkspaceSelection" />
      </div>
      <TerminalBase
        v-if="hasAnyTab && !booting"
        v-show="!isEmptyScreenVisible"
        ref="terminalBaseView"
        :is-panel-bottom="isPanelBottom"
      >
        <StatusOverlay :visible="isOffline" label="Connection lost" variant="error" />
      </TerminalBase>
      <Modal />
    </div>
    <KeyboardBar :is-panel-bottom="isPanelBottom" />
    <div v-if="booting || isLaunching" class="block-layer"></div>

  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import WorkspaceStatusBar from "./WorkspaceStatusBar.vue";
import TabBar from "./TabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import KeyboardBar from "./KeyboardBar.vue";
import ScreenEmpty from "./ScreenEmpty.vue";
import Modal from "./Modal.vue";
import StatusOverlay from "./StatusOverlay.vue";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminal } from "../composables/useTerminal.js";
import { useViewport } from "../composables/useViewport.js";
import { useSessionSync } from "../composables/useSessionSync.js";
import { useSnippetPersist } from "../composables/useSnippetPersist.js";
import { useDebugMode, useDebugLevels } from "../composables/useDebugMode.js";
import { useClientLogs } from "../composables/useClientLogs.js";
import { useAppBootstrap } from "../composables/useAppBootstrap.js";
import { useTerminalLifecycle } from "../composables/useTerminalLifecycle.js";
import { useSessionResume } from "../composables/useSessionResume.js";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts.js";
import { useDeepLink } from "../composables/useDeepLink.js";
import { useLayoutPersist } from "../composables/useLayoutPersist.js";
import { on, emit } from "../app-bridge.js";
import { tabTitleLabel } from "../utils/tab-label.js";

const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const { isOffline } = useConnectivityMonitor();
const workspaceStore = useWorkspaceStore();
const { connectDeferredTabs } = useTerminal();
const { initViewport } = useViewport();
const keyboardOpen = ref(false);
const { startSyncPolling, stopSyncPolling } = useSessionSync();
const { loadSnippetCache, addSnippet, deleteSnippet, moveSnippetToFront } = useSnippetPersist();

const tabBarView = ref(null);
const terminalBaseView = ref(null);

const { booting, bootMessage, initializeApp } = useAppBootstrap();
const { apply: applyDeepLink, attachSessionTab } = useDeepLink();
const { startWatching: startLayoutPersist } = useLayoutPersist();
const {
  activateTerminalTab,
  launchTerminal,
  refreshTab,
  closeTab,
  isLaunching,
} = useTerminalLifecycle({ terminalBaseView });

useSessionResume({ terminalBaseView });
useGlobalShortcuts({ closeTab });

const openTabs = computed(() => terminalStore.openTabs);
const hasAnyTab = computed(() => openTabs.value.length > 0);
const isEmptyScreenVisible = computed(() => {
  if (layoutStore.isSplitMode) return false;
  if (openTabs.value.length > 0) return false;
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
  const label = tabTitleLabel(tab, workspaceStore.allWorkspaces);
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

  bridgeCleanups.push(on("tab:select", ({ tab, skipFocus }) => {
    activateTerminalTab(tab.id, { focus: !skipFocus });
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

  bridgeCleanups.push(on("snippet:add", ({ label, command }) => addSnippet(label, command)));
  bridgeCleanups.push(on("snippet:delete", ({ index }) => deleteSnippet(index)));
  bridgeCleanups.push(on("snippet:use", ({ command }) => moveSnippetToFront(command)));

  loadSnippetCache();

  bridgeCleanups.push(on("connectivity:back", () => {
    // サーバ復活直後、bach-off で待ち状態にある WS タブを即時再接続させる。
    for (const tab of terminalStore.openTabs) {
      if (tab._wsDisposed || tab.ws) continue;
      if (tab._reconnectTimer) clearTimeout(tab._reconnectTimer);
      tab._reconnectTimer = null;
      tab._reconnectAttempts = 0;
      refreshTab(tab);
    }
  }));

  bridgeCleanups.push(on("oskeyboard:show", () => { keyboardOpen.value = true; }));
  bridgeCleanups.push(on("oskeyboard:hide", () => { keyboardOpen.value = false; }));
  bridgeCleanups.push(on("notification:open-session", ({ sessionId }) => { attachSessionTab(sessionId); }));

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
    applyDeepLink();
    startSyncPolling();
    startLayoutPersist();
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
.content-area {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

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

.block-layer {
  position: absolute;
  inset: 0;
  z-index: 45;
  background: var(--overlay-bg);
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
  padding: 0 4px;
  gap: 2px;
}

.main-panel.panel-bottom :deep(.tab-btn) {
  border-radius: 0;
  padding: 12px 16px;
  min-width: 0;
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
