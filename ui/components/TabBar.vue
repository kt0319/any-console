<template>
  <div class="tab-bar-row" :style="{ display: showBarRow ? 'flex' : 'none' }">
    <div class="tab-bar" :style="{ display: isSplitMode ? 'none' : '' }" @dblclick.self="onBarDblClick">
      <TabItem
        v-for="item in sortedItems"
        :key="item.tab.id || item.tab.wsUrl"
        :tab="item.tab"
        :active-tab-id="activeTabId"
        :is-panel-bottom="isPanelBottom"
        @select="onSelect"
        @close="onClose"

      />
      <button class="tab-add-btn" @click="onAddClick" title="Open Workspace">
        <span class="mdi mdi-plus"></span>
      </button>
    </div>
    <button v-if="!isSplitMode && hiddenTabCount > 0" class="tab-hidden-btn" :class="{ active: showHiddenTabs, flash: isFlashing }" @click="toggleHidden" title="Show hidden tabs">
      <span class="mdi" :class="showHiddenTabs ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"></span>
      <span class="tab-hidden-badge">{{ hiddenTabCount }}</span>
    </button>
    <button v-if="!isSplitMode" class="tab-settings-btn" @click="onSettingsClick" title="Settings">
      <span class="mdi mdi-cog"></span>
    </button>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
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
const showHiddenTabs = ref(false);

const hiddenTabCount = computed(() => props.tabs.filter((t) => t.hidden).length);
const isFlashing = ref(false);
let flashTimer = null;

watch(hiddenTabCount, (next, prev) => {
  if (next <= prev) return;
  if (flashTimer) clearTimeout(flashTimer);
  isFlashing.value = false;
  requestAnimationFrame(() => {
    isFlashing.value = true;
    flashTimer = setTimeout(() => { isFlashing.value = false; }, 2000);
  });
});

const visibleTabs = computed(() =>
  showHiddenTabs.value ? props.tabs : props.tabs.filter((t) => !t.hidden),
);

const sortedItems = computed(() => {
  return visibleTabs.value.map((tab, i) => ({ type: "tab", tab, index: i }));
});

const showBarRow = computed(() => {
  if (isSplitMode.value) return false;
  const hasAnyTabs = visibleTabs.value.length > 0 || hiddenTabCount.value > 0;
  return hasAnyTabs || layoutStore.isTouchDevice || isPanelBottom.value;
});

function onSelect(tab) {
  emit("tab:select", { tab });
}

let suppressAddUntil = 0;

function onClose(tab) {
  emit("tab:close", { tab });
  suppressAddUntil = Date.now() + 600;
}

function onBarDblClick() {
  emit("workspace:openModal");
}

function onAddClick() {
  if (Date.now() < suppressAddUntil) return;
  emit("workspace:openModal");
}

function toggleHidden() {
  showHiddenTabs.value = !showHiddenTabs.value;
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

.tab-hidden-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 2px;
  height: 30px;
  margin: 0;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}

.tab-hidden-btn:active {
  background: var(--bg-tertiary);
}

.tab-hidden-btn.active {
  color: #f7c948;
}

.tab-hidden-btn.flash {
  animation: hidden-btn-flash 2s ease-in-out 1;
}

@keyframes hidden-btn-flash {
  0%, 100% { color: var(--text-muted); }
  20%, 60% { color: #f7c948; }
  40%, 80% { color: var(--text-muted); }
}

.tab-hidden-badge {
  font-size: 13px;
  line-height: 1;
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
