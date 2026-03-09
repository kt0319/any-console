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
        @active-click="onActiveClick"
      />
    </div>
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

function onActiveClick() {
  emit("workspace:openModal");
}

function onBarDblClick() {
  emit("workspace:openModal");
}
</script>
