<template>
  <div class="main-panel" :style="{ '--session-sidebar-width': `min(${layoutStore.sessionSidebarWidth}px, 50vw)` }" :class="{ 'panel-bottom': isTabBarAtBottom, 'split-mode': isSplitMode, 'keyboard-open': layoutStore.isOsKeyboardOpen }">
    <TabBar ref="tabBarView" :tabs="openTabs" />
    <!-- PCのサイドバーはTabBarの行と高さを揃えるため.content-area配下ではなく.main-panel直下に置く。 -->
    <SessionSidebar />
    <div
      class="active-tab-title"
      :class="{ 'title-bar-at-bottom': titleBarAtBottom, 'active-tab-title-sidebar-open': isSessionSidebarOpen && !isNarrowViewport }"
      v-show="titleBarVisible"
    >
      <template v-if="debugMode">
        <span :class="['active-tab-debug', latestLog ? `debug-level-${latestLog.level}` : '']">{{ debugInfo }}</span>
      </template>
      <span v-else>{{ activeTabLabel || '\u00a0' }}</span>
    </div>
    <div class="content-area" :class="{ 'content-area-sidebar-open': isSessionSidebarOpen && !isNarrowViewport }">
      <div v-if="booting || isEmptyScreenVisible" class="screen-main-empty">
        <ScreenEmpty :booting="booting" :boot-message="bootMessage" @openWorkspace="openWorkspaceSelection" />
      </div>
      <TerminalBase
        v-if="hasAnyTab && !booting"
        v-show="!isEmptyScreenVisible"
        ref="terminalBaseView"
        :is-tab-bar-at-bottom="isTabBarAtBottom"
      >
        <StatusOverlay :visible="isOffline" label="Connection lost" variant="error" />
      </TerminalBase>
      <SessionListOverlay />
      <SessionOpenModal />
      <TerminalSettingsModal />
      <WorkspaceDetailModal />
    </div>
    <KeyboardBar :visible="keyboardBarVisible" :class="{ 'keyboard-bar-sidebar-open': isSessionSidebarOpen && !isNarrowViewport && !layoutStore.keyboardBarFullWidth }" />
    <div v-if="booting || isLaunching" class="block-layer"></div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import TabBar from "./TabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import KeyboardBar from "./KeyboardBar.vue";
import ScreenEmpty from "./ScreenEmpty.vue";
import SessionListOverlay from "./SessionListOverlay.vue";
import SessionOpenModal from "./SessionOpenModal.vue";
import TerminalSettingsModal from "./TerminalSettingsModal.vue";
import WorkspaceDetailModal from "./WorkspaceDetailModal.vue";
import SessionSidebar from "./SessionSidebar.vue";
import StatusOverlay from "./StatusOverlay.vue";
import { useConnectivityMonitor } from "../composables/useConnectivityMonitor.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useTerminal } from "../composables/useTerminal.ts";
import { useViewport } from "../composables/useViewport.ts";
import { useSessionSync } from "../composables/useSessionSync.ts";
import { useSnippetPersist } from "../composables/useSnippetPersist.ts";
import { useAppBootstrap } from "../composables/useAppBootstrap.ts";
import { useTerminalLifecycle } from "../composables/useTerminalLifecycle.ts";
import { useSessionResume } from "../composables/useSessionResume.ts";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts.ts";
import { useDeepLink } from "../composables/useDeepLink.ts";
import { useActiveTabLabel } from "../composables/useActiveTabLabel.ts";
import { useAnyOverlayOpen } from "../composables/useAnyOverlayOpen.ts";
import { useCommandPaletteOpener } from "../composables/useCommandPalette.ts";
import { useDebugInfoLine } from "../composables/useDebugInfoLine.ts";
import { useSplitLayoutPersist } from "../composables/useSplitLayoutPersist.ts";
import { emit } from "../app-bridge.ts";
import { useBusListener } from "../composables/useBusListener.ts";

const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const { isOffline } = useConnectivityMonitor();
const workspaceStore = useWorkspaceStore();
const { connectDeferredTabs } = useTerminal();
const { initViewport } = useViewport();
const { startSyncPolling, stopSyncPolling } = useSessionSync();
const { loadSnippetCache } = useSnippetPersist();

const tabBarView = ref<InstanceType<typeof TabBar> | null>(null);
// TerminalBase.vue が defineExpose する形のうち、ここで使う部分（useViewport の FitCallback が渡す scrollToBottom を含む）。
const terminalBaseView = ref<{ fitAllTerminals: (opts?: { force?: boolean, scrollToBottom?: boolean }) => void } | null>(null);

const { booting, bootMessage, initializeApp } = useAppBootstrap();
const { apply: applyDeepLink, attachSessionTab } = useDeepLink();
const { startWatching: startLayoutPersist } = useSplitLayoutPersist();
const {
  activateTerminalTab,
  launchTerminal,
  reconnectTab,
  terminateTab,
  isLaunching,
} = useTerminalLifecycle({ terminalBaseView });

useSessionResume({ terminalBaseView });
useGlobalShortcuts({ terminateTab });

const openTabs = computed(() => terminalStore.openTabs);
const hasAnyTab = computed(() => openTabs.value.length > 0);
const isEmptyScreenVisible = computed(() => {
  if (layoutStore.isSplitMode) return false;
  return openTabs.value.length === 0;
});

watch(isEmptyScreenVisible, async (isEmpty) => {
  if (!isEmpty) {
    await nextTick();
    requestAnimationFrame(() => terminalBaseView.value?.fitAllTerminals());
  }
});

const activeTabLabel = useActiveTabLabel(isEmptyScreenVisible);
const { debugMode, latestLog, debugInfo } = useDebugInfoLine();

const isTabBarAtBottom = computed(() => layoutStore.isTabBarAtBottom);
// インラインサイドバー vs SessionListOverlay.vueの全面オーバーレイの出し分けは、タブ位置設定ではなく
// 実際の画面幅で判定する。
const isNarrowViewport = computed(() => layoutStore.isNarrowViewport);
// 送信先のターミナルが無い間（空画面）はキーボードバーを出さない。
const keyboardBarVisible = computed(() => layoutStore.keyboardBarVisible && (hasAnyTab.value || booting.value));
const titleBarVisible = computed(() => layoutStore.titleBarVisible);
const titleBarAtBottom = computed(() => layoutStore.titleBarAtBottom);
const isSplitMode = computed(() => layoutStore.isSplitMode);
const isSessionSidebarOpen = computed(() => layoutStore.isSessionSidebarOpen);

useAnyOverlayOpen();
useCommandPaletteOpener();

function openWorkspaceSelection() {
  emit("workspace:openModal");
}

useBusListener("layout:fitAll", (detail) => {
    connectDeferredTabs();
  terminalBaseView.value?.fitAllTerminals(detail);
});

useBusListener("tab:select", ({ tab, skipFocus }) => {
  activateTerminalTab(tab.id, { focus: !skipFocus });
  if (tab.workspace) {
    workspaceStore.selectedWorkspace = tab.workspace;
  }
});

useBusListener("tab:close", ({ tab }) => {
  terminateTab(tab);
  const activeTab = terminalStore.activeTab;
  workspaceStore.selectedWorkspace = activeTab?.workspace || null;
});

useBusListener("tab:reconnect", ({ tab }) => {
  reconnectTab(tab);
});

useBusListener("terminal:launch", (detail) => {
  launchTerminal(detail);
});

useBusListener("connectivity:back", () => {
  // サーバ復活直後、bach-off で待ち状態にある WS タブを即時再接続させる。
  for (const tab of terminalStore.openTabs) {
    if (tab._wsDisposed || tab.ws) continue;
    if (tab._reconnectTimer) clearTimeout(tab._reconnectTimer);
    tab._reconnectTimer = null;
    tab._reconnectAttempts = 0;
    reconnectTab(tab);
  }
});

useBusListener("notification:openSession", ({ sessionId }) => { attachSessionTab(sessionId); });

onMounted(() => {
  loadSnippetCache();
  initViewport((opts) => {
    terminalBaseView.value?.fitAllTerminals(opts);
  });
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
  stopSyncPolling();
});

defineExpose({
  tabBar: tabBarView,
  terminalSplit: terminalBaseView,
});
</script>

<style scoped>
/* ボーダーは各バーに持たせず、ターミナル本体の上下端に常設する（どのバーが隣接するかはタブ位置・タイトルバー位置の組み合わせ次第のため）。 */
.content-area {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

/* PCでサイドバーを開いている間は、被せずSessionSidebar.vueの幅ぶん右へ縮める（TabBar.vueと同じ幅）。
   marginで実幅を変えるとResizeObserver（useTerminalResize.ts）がfit/sendResizeする（オーバーレイだと列数が変わらない）。 */
.content-area-sidebar-open {
  margin-left: var(--session-sidebar-width);
}

.screen-main-empty {
  flex: 1;
  min-height: 0;
  display: flex;
}

.active-tab-title {
  /* 表示/非表示はv-show（titleBarVisible）がインラインstyleで制御する。ここは表示時のレイアウトのみ。
     Top位置はTabBarのorder（既定0・panel-bottom時2）より小さい値にして常にタブより上に置く。 */
  display: flex;
  order: -10;
  flex-shrink: 0;
  align-items: flex-end;
  justify-content: center;
  min-height: 32px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
  padding: 4px 12px 6px;
  background: var(--bg-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* PCでサイドバーを開いている間は、TabBar.vueの.tab-bar-row-sidebar-open と同じ幅ぶん右へ縮める
   （SessionSidebar.vueはmain-panel全高に重なるオーバーレイのため、タイトルバー側で避ける）。 */
.active-tab-title-sidebar-open {
  margin-left: var(--session-sidebar-width);
}

.active-tab-title > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  /* min-width:auto だとnowrapテキストの実幅が下限になり、省略記号が出ず親のoverflow:hiddenで切れるため。 */
  min-width: 0;
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

@media (hover: hover) and (pointer: fine) {
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
  padding-bottom: 0;
  /* タブが無い時に行がpaddingだけで縮まないよう、TabBar.vue既定値と同じ44pxを床にする。 */
  min-height: 44px;
}

.main-panel.panel-bottom :deep(.tab-bar) {
  padding: 0 4px;
  /* 「+」隣の縦線の中央位置(::before)は gap + .tab-menu-btn の margin-left 4px の合計が奇数でないと整数pxで中央にできない。3pxで合計7px。 */
  gap: 3px;
}

.main-panel.panel-bottom :deep(.tab-btn) {
  border-radius: 0;
  padding: 12px 16px;
  min-width: 0;
  justify-content: center;
}

/* TabBar.vue側の元セレクタ(:has()込み)に詳細度で負けないよう、同じ条件を.main-panel.panel-bottom配下に足す。 */
.main-panel.panel-bottom :deep(.tab-bar-tabs):has(.tab-btn):not(:has(.tab-btn.active:last-child)) + .tab-menu-btn::before {
  left: -4px;
}

.main-panel.panel-bottom :deep(.keyboard-bar) {
  order: 0;
}

/* タイトルバーの位置は Settings > Display でタブバー位置と独立に設定でき、表示/非表示は v-show が制御するため display は含めない。
   既定のorderがTop相当で、.title-bar-at-bottom 時はTabBar側のorder（既定0/panel-bottom時2）より確実に大きい値で常に最後尾に置く。 */
.active-tab-title.title-bar-at-bottom {
  order: 100;
  padding: 0 12px;
  padding-bottom: env(safe-area-inset-bottom);
}

.main-panel.keyboard-open :deep(.tab-bar-row:not(.tab-bar-row-palette)) {
  display: none !important;
}

:global(.pwa .main-panel.panel-bottom .tab-bar) {
  padding-bottom: 0;
}

:global(.pwa .main-panel.panel-bottom .tab-bar-row) {
  padding-bottom: 0;
}

:global(.pwa .active-tab-title.title-bar-at-bottom) {
  align-items: center;
  padding-top: max(0px, calc(14px - env(safe-area-inset-bottom)));
  padding-bottom: max(calc(env(safe-area-inset-bottom) / 2), 14px);
}
</style>
