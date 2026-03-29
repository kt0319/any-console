<template>
  <div class="tab-bar-row" :style="{ display: showBarRow ? 'flex' : 'none' }">
    <div class="tab-bar" :style="{ display: isSplitMode ? 'none' : '' }" @dblclick.self="onBarDblClick">
      <TabItem
        v-for="item in sortedItems"
        :key="item.tab.id || item.tab.wsUrl"
        :tab="item.tab"
        :active-tab-id="activeTabId"
        :is-panel-bottom="isPanelBottom"
        :is-orphan="item.type === 'orphan'"
        @select="onSelect"
        @close="onClose"

      />
      <button class="tab-add-btn" @click="onAddClick" title="ワークスペースを開く">
        <span class="mdi mdi-plus"></span>
      </button>
    </div>
    <button v-if="!isSplitMode" class="tab-settings-btn" @click="onSettingsClick" title="設定">
      <span class="mdi mdi-cog"></span>
    </button>
  </div>
</template>

<script setup>
import { computed } from "vue";
import TabItem from "./TabItem.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { emit } from "../app-bridge.js";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const props = defineProps({
  tabs: { type: Array, default: () => [] },
  orphans: { type: Array, default: () => [] },
});

const activeTabId = computed(() => terminalStore.activeTabId);
const isPanelBottom = computed(() => layoutStore.isPanelBottom);
const isSplitMode = computed(() => layoutStore.isSplitMode);

const sortedItems = computed(() => {
  const items = props.tabs.map((tab, i) => ({ type: "tab", tab, index: i }));
  for (const s of props.orphans) {
    items.push({ type: "orphan", tab: s, index: s.tabIndex != null ? s.tabIndex : items.length });
  }
  items.sort((a, b) => a.index - b.index);
  return items;
});

const showBarRow = computed(() => {
  if (isSplitMode.value) return false;
  const hasAnyTabs = props.tabs.length > 0 || props.orphans.length > 0;
  return hasAnyTabs || layoutStore.isTouchDevice || isPanelBottom.value;
});

function onSelect(tab) {
  emit("tab:select", { tab });
}

function onClose(tab) {
  emit("tab:close", { tab });
}

function onBarDblClick() {
  emit("workspace:openModal");
}

function onAddClick() {
  emit("workspace:openModal");
}

function onSettingsClick() {
  emit("settings:open");
}
</script>

<style scoped>
.tab-bar-row {
  display: none;
  align-items: center;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 37px;
  touch-action: pan-x;
}

.tab-bar {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 30px;
  gap: 2px;
  padding: 4px 8px 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.tab-bar::-webkit-scrollbar {
  display: none;
}

.tab-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.tab-add-btn:active {
  background: var(--bg-tertiary);
}

.tab-settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  margin: 0 4px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.tab-settings-btn:active {
  background: var(--bg-tertiary);
}
</style>
