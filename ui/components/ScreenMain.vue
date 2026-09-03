<template>
  <div class="main-panel" :class="{ 'panel-bottom': isPanelBottom, 'split-mode': isSplitMode, 'keyboard-open': layoutStore.isOsKeyboardOpen }">
    <TabBar ref="tabBarView" :tabs="openTabs" />
    <!-- PCのサイドバーはTabBarの行とヘッダー高さを揃えるため.content-area配下ではなく
         .main-panel直下に置く（.content-area内だとactive-tab-title分だけ下にずれる）。 -->
    <SessionSidebar />
    <div class="active-tab-title" :class="{ 'title-bar-at-bottom': titleBarAtBottom }" v-show="titleBarVisible">
      <template v-if="debugMode">
        <span :class="['active-tab-debug', latestLog ? `debug-level-${latestLog.level}` : '']">{{ debugInfo }}</span>
      </template>
      <span v-else>{{ activeTabLabel || ' ' }}</span>
    </div>
    <div class="content-area" :class="{ 'content-area-sidebar-open': isSessionSidebarOpen && !isNarrowViewport }">
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
      <SessionOpenModal />
      <TerminalSettingsModal />
      <WorkspaceDetailModal />
    </div>
    <KeyboardBar :visible="keyboardBarVisible" />
    <div v-if="booting || isLaunching" class="block-layer"></div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import TabBar from "./TabBar.vue";
import TerminalBase from "./TerminalBase.vue";
import KeyboardBar from "./KeyboardBar.vue";
import ScreenEmpty from "./ScreenEmpty.vue";
import Modal from "./Modal.vue";
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
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";
import { useSettingsNav } from "../composables/useSettingsNav.ts";
import { useWorkspaceDetailNav } from "../composables/useWorkspaceDetailNav.ts";
import { useDebugMode, useDebugLevels } from "../composables/useDebugMode.ts";
import { useClientLogs } from "../composables/useClientLogs.ts";
import { useAppBootstrap } from "../composables/useAppBootstrap.ts";
import { useTerminalLifecycle } from "../composables/useTerminalLifecycle.ts";
import { useSessionResume } from "../composables/useSessionResume.ts";
import { useGlobalShortcuts } from "../composables/useGlobalShortcuts.ts";
import { useDeepLink } from "../composables/useDeepLink.ts";
import { useLayoutPersist } from "../composables/useLayoutPersist.ts";
import { on, emit } from "../app-bridge.ts";
import { isEmptyPaneId } from "../utils/empty-pane.ts";
import { tabTitleLabel } from "../utils/tab-label.ts";

const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const { isOffline } = useConnectivityMonitor();
const workspaceStore = useWorkspaceStore();
const { connectDeferredTabs } = useTerminal();
const { initViewport } = useViewport();
const { startSyncPolling, stopSyncPolling } = useSessionSync();
const { loadSnippetCache } = useSnippetPersist();

const tabBarView = ref<InstanceType<typeof TabBar> | null>(null);
// TerminalBase.vue が defineExpose する形のうち、ここで使う部分
// （useTerminalLifecycle.ts 内の TerminalBaseViewRef と同形 + useViewport の
// FitCallback が渡す scrollToBottom）。
const terminalBaseView = ref<{ fitAllTerminals: (opts?: { force?: boolean, scrollToBottom?: boolean }) => void } | null>(null);

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
  return openTabs.value.length === 0;
});

watch(isEmptyScreenVisible, async (isEmpty) => {
  if (!isEmpty) {
    await nextTick();
    requestAnimationFrame(() => terminalBaseView.value?.fitAllTerminals());
  }
});

const activeTabLabel = computed(() => {
  // tab は markRaw のため tab.workspace 単体の変更は追跡されない。Add で
  // ベアターミナルにワークスペースを紐付けた直後もタイトルに反映されるよう、
  // tabWorkspaceVersion を読んで依存に含める。
  terminalStore.tabWorkspaceVersion;
  if (isEmptyScreenVisible.value) return "";
  let tabId = terminalStore.activeTabId;
  if (layoutStore.isSplitMode) {
    const paneId = layoutStore.splitPaneTabIds[layoutStore.activePaneIndex];
    if (paneId != null && !isEmptyPaneId(paneId)) tabId = paneId;
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
// インラインサイドバー vs Modal.vueの全面オーバーレイの出し分けは、タブ位置設定ではなく
// 実際の画面幅で判定する。
const isNarrowViewport = computed(() => layoutStore.isNarrowViewport);
const keyboardBarVisible = computed(() => layoutStore.keyboardBarVisible);
const titleBarVisible = computed(() => layoutStore.titleBarVisible);
const titleBarAtBottom = computed(() => layoutStore.titleBarAtBottom);
const isSplitMode = computed(() => layoutStore.isSplitMode);
const isSessionSidebarOpen = computed(() => layoutStore.isSessionSidebarOpen);

// isSettingsOpenは「いずれかのオーバーレイが表示中か」を表す既存フラグ（useTerminalInput/
// useGlobalShortcutsがショートカット抑止に使う）。4つの独立オーバーレイに分離したためここで集約する。
const { isOpen: isSessionListOverlayOpen } = useSessionListOverlay();
const { isOpen: isSessionOpenNavOpen } = useSessionOpenNav();
const { isOpen: isSettingsNavOpen } = useSettingsNav();
const { isOpen: isWorkspaceDetailOpen } = useWorkspaceDetailNav();
watch(
  [isSessionListOverlayOpen, isSessionOpenNavOpen, isSettingsNavOpen, isWorkspaceDetailOpen],
  ([sessionList, sessionOpen, settings, workspaceDetail]) => {
    layoutStore.isSettingsOpen = sessionList || sessionOpen || settings || workspaceDetail;
  },
  { immediate: true },
);

function openWorkspaceSelection() {
  emit("workspace:openModal");
}

const bridgeCleanups: (() => void)[] = [];

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
    const activeTab = terminalStore.activeTab;
    workspaceStore.selectedWorkspace = activeTab?.workspace || null;
  }));

  bridgeCleanups.push(on("tab:refresh", ({ tab }) => {
    refreshTab(tab);
  }));

  bridgeCleanups.push(on("terminal:launch", (detail) => {
    launchTerminal(detail);
  }));

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

  bridgeCleanups.push(on("notification:open-session", ({ sessionId }) => { attachSessionTab(sessionId); }));

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
  bridgeCleanups.forEach((cleanup) => cleanup());
  stopSyncPolling();
});

defineExpose({
  tabBar: tabBarView,
  terminalSplit: terminalBaseView,
});
</script>

<style scoped>
/* ボーダーはTabBar/TitleBar/KeyboardBar個々には持たせず、ここ（ターミナル本体）
   の上下端に常設する。タブ位置・タイトルバー位置は独立に上下を切り替えられる
   ため、どのバーが実際にターミナルへ隣接するかは組み合わせ次第で変わる。
   各バー側で位置ごとに条件分岐してボーダーを付け替えるより、常に
   ターミナルとの境目にだけ線を引く方が組み合わせに依存せず正しくなる。 */
.content-area {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

/* PCでセッションサイドバーを開いている間は、ターミナルに被せず
   SessionSidebar.vue の幅（--session-sidebar-width）ぶん右へ縮める。TabBar.vue の
   .tab-bar-row-sidebar-open と同じ幅を使う。marginで実際の描画幅を
   変えることで、TerminalBase配下のResizeObserver（useTerminalResize.ts）
   が幅変化を検知して自動でfitTerminal/sendResizeする（オーバーレイで
   隠すだけだと見た目は隠れても列数はリサイズされないため）。 */
.content-area-sidebar-open {
  margin-left: var(--session-sidebar-width);
}

.screen-main-empty {
  flex: 1;
  min-height: 0;
  display: flex;
}

.active-tab-title {
  /* 表示/非表示自体はv-show（titleBarVisible、Settings > Displayの狭い/広い
     設定）がインラインstyleで制御する。ここはflexで表示された時のレイアウト
     のみ定義する。
     Top位置（既定、.title-bar-at-bottomが付かない状態）は、TabBarの
     order（既定0・panel-bottom時2）より確実に小さい値にして、タブバーの
     位置設定に関わらず常にセッションタブより上に表示されるようにする。 */
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
  /* モバイルの.tab-btn（padding 12px 16px）はTabBar.vue既定のmin-height(37px)
     より実高さが大きく、タブが1件も無い時（.tab-barが空）だけ37pxに縮んで
     見えてしまう。タブ有無で行の高さが変わらないよう、タップターゲットの
     推奨サイズ（44px）をここで床にする。 */
  min-height: 44px;
}

.main-panel.panel-bottom :deep(.tab-bar) {
  padding: 0 4px;
  /* TabBar.vueの「+」隣の縦線の中央位置(::before)は隙間(gap + .tab-menu-btnの
     margin-left 4px)から算出しており、その合計が奇数でないと整数pxで
     中央にできない。3pxにして合計7px(-4pxで中央)にする。 */
  gap: 3px;
}

.main-panel.panel-bottom :deep(.tab-btn) {
  border-radius: 0;
  padding: 12px 16px;
  min-width: 0;
  justify-content: center;
}

/* TabBar.vue側の元セレクタ(:has()込みで詳細度が高い)に負けないよう、同じ
   条件をそのまま.main-panel.panel-bottomの下に足して詳細度で上回る。 */
.main-panel.panel-bottom :deep(.tab-bar-tabs):has(.tab-btn):not(:has(.tab-btn.active:last-child)) + .tab-menu-btn::before {
  left: -4px;
}

.main-panel.panel-bottom :deep(.keyboard-bar) {
  order: 0;
}

/* タイトルバーの位置（Top/Bottom）はSettings > Displayでタブバー位置とは
   独立に設定できる（titleBarPosition）。表示/非表示自体はv-show
   （titleBarVisible）が制御するため、ここにはdisplayを含めない。
   既定のorder(未指定=0相当)がTop相当（TabBarの直後・content-areaの前に
   自然に並ぶ）で、.title-bar-at-bottomが付いた時だけBottom相当（他の
   全要素より後ろ）に回す。orderの大小関係はTabBar側のorder（既定0/
   panel-bottom時2）より確実に大きい値にし、タブバーの位置設定に関わらず
   常に最後尾（画面最下部）に来るようにする。 */
.active-tab-title.title-bar-at-bottom {
  order: 100;
  padding: 0 12px;
  padding-bottom: env(safe-area-inset-bottom);
}

.main-panel.keyboard-open :deep(.tab-bar-row) {
  display: none !important;
}

:global(.pwa .main-panel.panel-bottom .tab-bar) {
  padding-bottom: 0;
}

:global(.pwa .main-panel.panel-bottom .tab-bar-row) {
  padding-bottom: 0;
}

:global(.pwa .active-tab-title.title-bar-at-bottom) {
  padding-bottom: calc(env(safe-area-inset-bottom) + 14px);
}
</style>
