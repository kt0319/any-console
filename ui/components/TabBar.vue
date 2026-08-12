<template>
  <div
    class="tab-bar-row"
    :class="{ 'tab-bar-row-sidebar-open': isSidebarOpen && !isPanelBottom }"
  >
    <!-- PCはサイドバー（SessionListPanel.vue）のタイトル行右端に専用の閉じる
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
    <div
      ref="tabListEl"
      class="tab-bar"
      @keydown="onTabListKeydown"
    >
      <div class="tab-bar-tabs" role="tablist" aria-label="Open terminal tabs">
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
      <button
        type="button"
        class="tab-menu-btn hover-bg"
        :class="{ active: isSessionOpenOpen, 'tab-panel-bottom': isPanelBottom, 'tab-underline-active': isSessionOpenOpen, 'tab-underline-top': isPanelBottom }"
        @click="onOpenSessionClick"
        :aria-label="openSessionLabel"
        :aria-expanded="isSessionOpenOpen ? 'true' : 'false'"
        :data-tooltip="openSessionLabel"
      >
        <span :class="['mdi', isSessionOpenOpen ? 'mdi-close' : 'mdi-plus']"></span>
      </button>
    </div>
    <button
      type="button"
      class="tab-menu-btn hover-bg"
      :class="{ active: isSettingsOpen, 'tab-panel-bottom': isPanelBottom, 'tab-underline-active': isSettingsOpen, 'tab-underline-top': isPanelBottom }"
      @click="onSettingsClick"
      :aria-label="settingsLabel"
      :aria-expanded="isSettingsOpen ? 'true' : 'false'"
      :data-tooltip="settingsLabel"
    >
      <span :class="['mdi', isSettingsOpen ? 'mdi-close' : 'mdi-cog']"></span>
    </button>
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import TabItem from "./TabItem.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.js";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.js";
import { useSettingsNav } from "../composables/useSettingsNav.js";
import { emit } from "../app-bridge.js";
import { nextTabIndex } from "../utils/tab-nav.js";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const props = defineProps({
  tabs: { type: Array, default: () => [] },
});

const tabListEl = ref(null);
const activeTabId = computed(() => terminalStore.activeTabId);
const isPanelBottom = computed(() => layoutStore.isPanelBottom);
const isSidebarOpen = computed(() => layoutStore.isSessionSidebarOpen);
const sidebarToggleLabel = computed(() => (isSidebarOpen.value ? "Close session list" : "Open session list"));
const sortedItems = computed(() => {
  return props.tabs
    .filter((tab) => !terminalStore.tabFlags[tab.id]?.autoDiscovered)
    .map((tab, i) => ({ type: "tab", tab, index: i }));
});

function onSelect(tab, { skipFocus = false } = {}) {
  emit("tab:select", { tab, skipFocus });
}

function focusTab(tab) {
  nextTick(() => {
    tabListEl.value?.querySelector(`[data-tab-id="${tab.id}"]`)?.focus?.();
  });
}

function onTabListKeydown(e) {
  const tabs = sortedItems.value.map((item) => item.tab);
  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId.value);
  const nextIndex = nextTabIndex(e.key, currentIndex, tabs.length);
  if (nextIndex === null) return;

  e.preventDefault();
  const nextTab = tabs[nextIndex];
  onSelect(nextTab, { skipFocus: true });
  focusTab(nextTab);
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

const { isOpen: isSessionListOpen, open: openSessionList, close: closeSessionList } = useSessionListOverlay();
const { isOpen: isSessionOpenOpen, openView: openSessionOpenView, closeNav: closeSessionOpenNav } = useSessionOpenNav();
const { isOpen: isSettingsOpen, openView: openSettingsView, closeNav: closeSettingsNav } = useSettingsNav();
const openSessionLabel = computed(() => (isSessionOpenOpen.value ? "Close open session" : "Open session"));
const settingsLabel = computed(() => (isSettingsOpen.value ? "Close settings" : "Settings"));

function onMenuClick() {
  // 開閉のexclusive制御（他オーバーレイを閉じる/閉じないの判定）は
  // useSessionListOverlay.js（useExclusiveMobileOverlay.js経由）に集約されて
  // いるため、ここでは単純に開閉を切り替えるだけでよい。
  if (isSessionListOpen.value) closeSessionList();
  else openSessionList();
}

function onOpenSessionClick() {
  if (isSessionOpenOpen.value) closeSessionOpenNav();
  else openSessionOpenView("WorkspaceOpen");
}

function onSettingsClick() {
  if (isSettingsOpen.value) closeSettingsNav();
  else openSettingsView("ModalMenu");
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

/* role="tablist"の直接の子はrole="tab"だけを許容する（aria-required-children）
   ため、タブ本体だけをこの内側の要素に分離する。「+」ボタンは.tab-barの
   スクロール領域には残しつつ、tablistの外に置いて最後のタブのすぐ右に
   並べる。
   min-width:0にすると、タブ本体の合計幅が.tab-barの表示幅を超えた時に
   このラッパー自身がflexアイテムとして縮められてしまい、中の各タブ
   （縮まない固定幅）がラッパーの外へはみ出して「+」ボタンと重なる不具合が
   あった。flex-shrink:0でラッパー自体は常に中身の実幅を保ち、はみ出し分は
   親の.tab-bar（overflow-x:auto）側でスクロールさせる。 */
.tab-bar-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
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
