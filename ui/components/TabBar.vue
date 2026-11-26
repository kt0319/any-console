<template>
  <div
    class="tab-bar-row"
    :class="{ 'tab-bar-row-palette': isSidebarOpen, 'tab-bar-row-sidebar-open': isSidebarOpen && !isNarrowViewport }"
  >
    <!-- 開いている間は✕になり、右に検索入力を出す。モバイルはタブ類を隠して入力だけ、PCはタブを入力の右へ続ける -->
    <button
      class="tab-menu-btn hover-bg"
      :class="{ 'tab-panel-bottom': isTabBarAtBottom, 'tab-underline-top': isTabBarAtBottom }"
      @click="onMenuClick"
      :aria-label="sidebarToggleLabel"
      :aria-expanded="isSidebarOpen ? 'true' : 'false'"
      :data-tooltip="sidebarToggleLabel"
    >
      <span :class="['mdi', isSidebarOpen ? 'mdi-close' : 'mdi-menu']"></span>
    </button>
    <CommandPaletteInput
      v-if="isSidebarOpen"
      class="tab-bar-palette"
      :class="{ 'tab-bar-palette-inline': !isNarrowViewport }"
    />
    <div
      v-show="showTabs"
      ref="tabListEl"
      class="tab-bar"
      :style="tabBarFadeStyle"
      @keydown="onTabListKeydown"
      @scroll="updateScrollFade"
    >
      <div class="tab-bar-tabs" role="tablist" aria-label="Open terminal tabs">
        <div
          v-for="group in tabGroups"
          :key="group.key"
          class="tab-group"
          role="presentation"
          :class="{ grouped: group.items.length > 1 }"
        >
          <TabItem
            v-for="(item, index) in group.items"
            :key="item.tab.id || item.tab.wsUrl"
            :tab="item.tab"
            :active-tab-id="activeTabId"
            :is-tab-bar-at-bottom="isTabBarAtBottom"
            :is-narrow="isNarrowViewport"
            :in-group="group.items.length > 1"
            :follows-base="index > 0"
            @select="onSelect"
          />
        </div>
      </div>
      <button
        type="button"
        class="tab-menu-btn hover-bg"
        :class="{ active: isSessionOpenOpen, 'tab-panel-bottom': isTabBarAtBottom, 'tab-underline-active': isSessionOpenOpen, 'tab-underline-top': isTabBarAtBottom }"
        @click="onOpenSessionClick"
        :aria-label="openSessionLabel"
        :aria-expanded="isSessionOpenOpen ? 'true' : 'false'"
        :data-tooltip="openSessionLabel"
      >
        <span :class="['mdi', isSessionOpenOpen ? 'mdi-close' : 'mdi-plus']"></span>
      </button>
    </div>
    <button
      v-show="showTabs"
      type="button"
      class="tab-menu-btn hover-bg"
      :class="{ active: isSettingsOpen, 'tab-panel-bottom': isTabBarAtBottom, 'tab-underline-active': isSettingsOpen, 'tab-underline-top': isTabBarAtBottom }"
      @click="onSettingsClick"
      :aria-label="settingsLabel"
      :aria-expanded="isSettingsOpen ? 'true' : 'false'"
      :data-tooltip="settingsLabel"
    >
      <span :class="['mdi', isSettingsOpen ? 'mdi-close' : 'mdi-cog']"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type PropType } from "vue";
import TabItem from "./TabItem.vue";
import CommandPaletteInput from "./CommandPaletteInput.vue";
import { useTerminalStore, type TerminalTab } from "../stores/terminal.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useSessionListOverlay } from "../composables/useSessionListOverlay.ts";
import { useSessionOpenNav } from "../composables/useSessionOpenNav.ts";
import { useSettingsNav } from "../composables/useSettingsNav.ts";
import { emit } from "../app-bridge.ts";
import { nextTabIndex } from "../utils/tab-nav.ts";
import { groupTabsByBaseWorkspace } from "../utils/worktree.ts";
import { scrollFadeMaskImage } from "../utils/scroll-fade.ts";
import { TAB_BAR_FADE_WIDTH_PX } from "../utils/constants.ts";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const props = defineProps({
  tabs: { type: Array as PropType<TerminalTab[]>, default: () => [] },
});

const tabListEl = ref<HTMLElement | null>(null);
const activeTabId = computed(() => terminalStore.activeTabId);
const isTabBarAtBottom = computed(() => layoutStore.isTabBarAtBottom);
// サイドバーのインライン/全面オーバーレイ切替と同じ基準。TabItem.vue のラベル表示可否にも使う
const isNarrowViewport = computed(() => layoutStore.isNarrowViewport);
const isSidebarOpen = computed(() => layoutStore.isSessionSidebarOpen);
const showTabs = computed(() => !(isSidebarOpen.value && isNarrowViewport.value));
const sidebarToggleLabel = computed(() => (isSidebarOpen.value ? "Hide session list" : "Show session list"));
const sortedItems = computed(() => {
  return props.tabs
    .filter((tab) => !terminalStore.tabFlags[tab.id]?.autoDiscovered)
    .map((tab, i) => ({ type: "tab", tab, index: i }));
});

const tabGroups = computed(() => groupTabsByBaseWorkspace(sortedItems.value));

function onSelect(tab: TerminalTab, { skipFocus = false } = {}) {
  emit("tab:select", { tab, skipFocus });
}

function focusTab(tab: TerminalTab) {
  nextTick(() => {
    tabListEl.value?.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`)?.focus?.();
  });
}

// 横スクロールで隠れているタブがあることを端のフェードで示す
const canScrollLeft = ref(false);
const canScrollRight = ref(false);
const tabBarFadeStyle = computed(() => {
  const mask = scrollFadeMaskImage(canScrollLeft.value, canScrollRight.value, TAB_BAR_FADE_WIDTH_PX);
  return { maskImage: mask, webkitMaskImage: mask };
});

function updateScrollFade() {
  const el = tabListEl.value;
  if (!el) {
    canScrollLeft.value = false;
    canScrollRight.value = false;
    return;
  }
  canScrollLeft.value = el.scrollLeft > 0;
  canScrollRight.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
}

let tabBarResizeObserver: ResizeObserver | null = null;
watch(tabListEl, (el) => {
  tabBarResizeObserver?.disconnect();
  tabBarResizeObserver = null;
  if (!el) return;
  tabBarResizeObserver = new ResizeObserver(updateScrollFade);
  tabBarResizeObserver.observe(el);
  updateScrollFade();
}, { immediate: true });

// コンテナ幅不変でタブ数だけ変わるケースは ResizeObserver で検知できない
watch(() => sortedItems.value.length, () => nextTick(updateScrollFade));

onBeforeUnmount(() => {
  tabBarResizeObserver?.disconnect();
  tabBarResizeObserver = null;
});

function onTabListKeydown(e: KeyboardEvent) {
  const tabs = sortedItems.value.map((item) => item.tab);
  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId.value);
  const nextIndex = nextTabIndex(e.key, currentIndex, tabs.length);
  if (nextIndex === null) return;

  e.preventDefault();
  const nextTab = tabs[nextIndex];
  onSelect(nextTab, { skipFocus: true });
  focusTab(nextTab);
}

const { isOpen: isSessionListOpen, open: openSessionList, close: closeSessionList } = useSessionListOverlay();
const { isOpen: isSessionOpenOpen, openView: openSessionOpenView, closeNav: closeSessionOpenNav } = useSessionOpenNav();
const { isOpen: isSettingsOpen, openView: openSettingsView, closeNav: closeSettingsNav } = useSettingsNav();
const openSessionLabel = computed(() => (isSessionOpenOpen.value ? "Close open session" : "Open session"));
const settingsLabel = computed(() => (isSettingsOpen.value ? "Close settings" : "Settings"));

function onMenuClick() {
  if (isSessionListOpen.value) closeSessionList();
  else openSessionList();
}

function onOpenSessionClick() {
  if (isSessionOpenOpen.value) closeSessionOpenNav();
  else openSessionOpenView("SessionOpenHome");
}

function onSettingsClick() {
  if (isSettingsOpen.value) closeSettingsNav();
  else openSettingsView("SettingsMenu");
}
</script>

<style scoped>
.tab-bar-row {
  display: flex;
  background: var(--bg-secondary);
  flex-shrink: 0;
  /* ScreenMain.vue の panel-bottom 時と同値にし、SessionListPanel.vue の .settings-panel-header と高さを揃える */
  min-height: 44px;
}

/* ボタン+検索入力でサイドバー幅（--session-sidebar-width）を占める。サイドバー（absolute, z-index:15）に隠れないよう前面に出す */
.tab-bar-row-sidebar-open {
  position: relative;
  z-index: 16;
}

.tab-bar-palette {
  flex: 1;
  min-width: 0;
  align-self: center;
  margin-right: 8px;
}

/* ボタン（44px+左右margin4px）と右margin8pxを引き、行頭からちょうどサイドバー幅にする */
.tab-bar-palette-inline {
  flex: 0 0 calc(var(--session-sidebar-width) - 52px - 8px);
}

.tab-bar {
  display: flex;
  flex: 1;
  min-width: 0;
  /* .tab-bar-tabs の gap と同じ7px（「+」隣の縦線を整数pxで中央に置くため） */
  gap: 7px;
  padding: 0 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  touch-action: pan-x;
}

.tab-bar::-webkit-scrollbar {
  display: none;
}

/* tablist の直接の子は role="tab" のみ許容（aria-required-children）のため、タブ本体だけをこの要素に分離する。
   flex-shrink:0 でないとラッパーが縮み、固定幅のタブがはみ出して「+」と重なる。はみ出し分は親の .tab-bar でスクロールさせる。 */
.tab-bar-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 7px;
}

.tab-group {
  display: contents;
}

/* ベースとそのworktreeのタブを1つの塊として見せる */
.tab-group.grouped {
  display: flex;
  gap: 7px;
  background: var(--bg-tertiary);
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

/* 最後のタブが非アクティブの時だけ「+」との間に縦線を出す。隙間 gap(7px)+margin-left(4px)=11px のため -(11+1)/2 = -6px で中央 */
.tab-bar-tabs:has(.tab-btn):not(:has(.tab-btn.active:last-child)) + .tab-menu-btn::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--border);
}

/* 先頭タブが非アクティブの時だけサイドバーボタンとの間に縦線を出す。隙間 margin-right(4px)+padding-left(8px)=12px のため -(12+1)/2 = -6px で中央 */
.tab-bar-row:has(.tab-bar-tabs .tab-btn):not(:has(.tab-bar-tabs .tab-btn.active:first-child)) > .tab-menu-btn:first-child::after {
  content: "";
  position: absolute;
  right: -6px;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--border);
}

.tab-menu-btn:active {
  background: var(--bg-tertiary);
}


.tab-menu-btn.active {
  color: var(--text-primary);
  background: var(--accent-bg-12);
}

</style>
