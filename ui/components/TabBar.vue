<template>
  <div class="tab-bar-row" :style="{ display: showBarRow ? 'flex' : 'none' }">
    <div class="tab-bar" :style="{ display: isSplitMode ? 'none' : '' }">
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
      <button class="tab-add-btn" @click="onAddClick" title="Open Workspace">
        <span class="mdi mdi-plus"></span>
      </button>
    </div>
    <button
      v-if="!isSplitMode"
      class="tab-settings-btn"
      :class="{ active: isSettingsOpen, 'tab-panel-bottom': isPanelBottom, 'tab-underline-active': isSettingsOpen, 'tab-underline-top': isPanelBottom }"
      @click="onSettingsClick"
      :aria-label="isSettingsOpen ? 'Close settings' : 'Settings'"
      :data-tooltip="isSettingsOpen ? 'Close settings' : 'Settings'"
    >
      <span :class="['mdi', isSettingsOpen ? 'mdi-close' : 'mdi-cog']"></span>
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
});

const activeTabId = computed(() => terminalStore.activeTabId);
const isPanelBottom = computed(() => layoutStore.isPanelBottom);
const isSplitMode = computed(() => layoutStore.isSplitMode);
const isSettingsOpen = computed(() => layoutStore.isSettingsOpen);
const sortedItems = computed(() => {
  return props.tabs
    .filter((tab) => !terminalStore.tabFlags[tab.id]?.autoDiscovered)
    .map((tab, i) => ({ type: "tab", tab, index: i }));
});

const showBarRow = computed(() => !isSplitMode.value);

function onSelect(tab) {
  emit("tab:select", { tab });
}

let suppressAddUntil = 0;

function onClose(tab) {
  emit("tab:close", { tab });
  suppressAddUntil = Date.now() + 600;
}

function onRefresh(tab) {
  emit("tab:refresh", { tab });
}

function onDetach(tab) {
  terminalStore.detachTab(tab.id);
}

function onAddClick() {
  if (Date.now() < suppressAddUntil) return;
  emit("workspace:openModal");
}

function onSettingsClick() {
  if (isSettingsOpen.value) {
    emit("modal:close");
  } else {
    emit("settings:open");
  }
}
</script>

<style scoped>
.tab-bar-row {
  display: none;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 37px;
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

.tab-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  touch-action: manipulation;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.tab-add-btn:active {
  background: var(--bg-tertiary);
}

@media (hover: hover) and (pointer: fine) {
  .tab-add-btn:hover {
    background: var(--bg-tertiary);
  }
}

.tab-settings-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  align-self: stretch;
  width: 30px;
  margin: 0 4px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
}

.tab-settings-btn:active {
  background: var(--bg-tertiary);
}

@media (hover: hover) and (pointer: fine) {
  .tab-settings-btn:hover {
    background: var(--bg-tertiary);
  }
}

.tab-settings-btn.active {
  color: var(--text-primary);
  background: rgba(130, 170, 255, 0.12);
}

</style>
