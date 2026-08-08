<template>
  <div
    class="tab-bar-row"
    :class="{ 'tab-bar-row-sidebar-open': isSidebarOpen && !isPanelBottom }"
  >
    <!-- PCはサイドバー（SettingsPanel.vue）のタイトル行右端に専用の閉じる
         ボタンがあるため、サイドバーが開いている間はこのボタン自体を隠し
         タブだけにする。モバイルはこのボタンだけが開閉の手段のため常に出す。 -->
    <button
      v-if="isPanelBottom || !isSidebarOpen"
      class="tab-menu-btn hover-bg"
      :class="{ active: isSidebarOpen, 'tab-panel-bottom': isPanelBottom, 'tab-underline-active': isSidebarOpen, 'tab-underline-top': isPanelBottom }"
      @click="onMenuClick"
      :aria-label="sidebarToggleLabel"
      :aria-expanded="isSidebarOpen ? 'true' : 'false'"
      :data-tooltip="sidebarToggleLabel"
    >
      <span :class="['mdi', isSidebarOpen && isPanelBottom ? 'mdi-close' : 'mdi-menu']"></span>
    </button>
    <div class="tab-bar">
      <TabItem
        v-for="item in sortedItems"
        :key="item.tab.id || item.tab.wsUrl"
        :tab="item.tab"
        :active-tab-id="activeTabId"
        :is-panel-bottom="isPanelBottom"
        @select="onSelect"
        @close="onClose"
        @refresh="onRefresh"
        @detach="onDetach"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import TabItem from "./TabItem.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceDetailNav } from "../composables/useWorkspaceDetailNav.js";
import { useSettingsNav } from "../composables/useSettingsNav.js";
import { emit } from "../app-bridge.js";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const props = defineProps({
  tabs: { type: Array, default: () => [] },
});

const activeTabId = computed(() => terminalStore.activeTabId);
const isPanelBottom = computed(() => layoutStore.isPanelBottom);
const isSidebarOpen = computed(() => layoutStore.isSessionSidebarOpen);
// PCはセッション一覧+設定の入り口を兼ねる（歯車ボタン廃止）ため文言を変える。
const sidebarToggleLabel = computed(() => {
  if (isPanelBottom.value) return isSidebarOpen.value ? "Close session list" : "Open session list";
  return isSidebarOpen.value ? "Close sessions & settings" : "Open sessions & settings";
});
const sortedItems = computed(() => {
  return props.tabs
    .filter((tab) => !terminalStore.tabFlags[tab.id]?.autoDiscovered)
    .map((tab, i) => ({ type: "tab", tab, index: i }));
});

function onSelect(tab, { skipFocus = false } = {}) {
  emit("tab:select", { tab, skipFocus });
}

function onClose(tab) {
  emit("tab:close", { tab });
}

function onRefresh(tab) {
  emit("tab:refresh", { tab });
}

function onDetach(tab) {
  terminalStore.detachTab(tab.id);
}

const { isOpen: isWorkspaceDetailOpen, close: closeWorkspaceDetail } = useWorkspaceDetailNav();
const { openView } = useSettingsNav();

function onMenuClick() {
  if (isSidebarOpen.value) {
    // モバイルはハンバーガー1つでサイドバーとWorkspaceDetailオーバーレイの
    // 両方を閉じる（WorkspaceDetailはサイドバーとは独立した状態のため、
    // 閉じる時だけここで明示的に合わせる。PCはWorkspaceDetailModal.vue側に
    // 専用の閉じるボタンがあるため対象外）。
    if (isPanelBottom.value && isWorkspaceDetailOpen.value) closeWorkspaceDetail();
    layoutStore.toggleSessionSidebar();
  } else {
    // 開く時は常にセッション一覧（SessionList）から始める。前回設定の
    // 途中まで進んでいても、ハンバーガーで開き直したら一覧に戻す。
    openView("SessionList");
  }
}
</script>

<style scoped>
.tab-bar-row {
  display: flex;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 37px;
}

/* PCでセッションサイドバーを開いている間は、サイドバー幅（SessionSidebar.vue
   の.session-sidebar、--session-sidebar-width）ぶんタブバーを右へ縮める。サイドバーは
   position:absoluteでcontent-area側に重なるオーバーレイのため、タブバー側
   （TabBarは別要素）は自分では避けてくれず、ここで明示的にずらす。 */
.tab-bar-row-sidebar-open {
  margin-left: var(--session-sidebar-width);
}

.tab-bar {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 6px;
  padding: 0 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  touch-action: pan-x;
}

.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab-menu-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: stretch;
  aspect-ratio: 1;
  margin: 0 4px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
}

.tab-menu-btn:active {
  background: var(--bg-tertiary);
}


.tab-menu-btn.active {
  color: var(--text-primary);
  background: var(--accent-bg-12);
}

</style>
