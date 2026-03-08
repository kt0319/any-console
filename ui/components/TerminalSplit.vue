<template>
  <div
    id="output-container"
    :class="splitContainerClasses"
    ref="containerEl"
  >
    <template v-if="!splitMode">
      <TerminalPane
        v-for="tab in openTabs"
        v-show="tab.id === activeTabId"
        :key="tab.id"
        :tab="tab"
        ref="paneRefs"
      />
    </template>
    <template v-else>
      <template v-if="splitLayout === 'grid'">
        <div v-for="(row, ri) in gridRows" :key="'row-' + ri" class="split-row">
          <TerminalPane
            v-for="(pane, pi) in row"
            :key="pane.tabId"
            :tab="getTabById(pane.tabId)"
            :pane-index="pane.globalIndex"
            :class="['split-pane', 'pane-' + pane.globalIndex, { 'active-pane': pane.globalIndex === activePaneIndex }]"
            @select-pane="selectPane"
            ref="paneRefs"
          />
        </div>
      </template>
      <template v-else>
        <TerminalPane
          v-for="(tabId, idx) in splitPaneTabIds"
          :key="tabId"
          :tab="getTabById(tabId)"
          :pane-index="idx"
          :class="['split-pane', 'pane-' + idx, { 'active-pane': idx === activePaneIndex }]"
          @select-pane="selectPane"
          ref="paneRefs"
        />
      </template>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from "vue";
import TerminalPane from "./TerminalPane.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const containerEl = ref(null);
const paneRefs = ref([]);

const openTabs = computed(() => terminalStore.openTabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const splitMode = computed(() => layoutStore.splitMode);
const splitLayout = computed(() => layoutStore.splitLayout || "horizontal");
const splitPaneTabIds = computed(() => layoutStore.splitPaneTabIds);
const activePaneIndex = computed(() => layoutStore.activePaneIndex);

const splitContainerClasses = computed(() => {
  if (!splitMode.value) return {};
  return {
    "split-active": true,
    [`split-${splitLayout.value}`]: true,
    "split-mobile": layoutStore.panelBottom,
  };
});

function calcGridLayout(count) {
  if (count <= 1) return [1];
  if (count === 2) return [1, 1];
  if (count === 3) return [2, 1];
  if (count === 4) return [2, 2];
  return [3, Math.max(1, count - 3)];
}

const gridRows = computed(() => {
  if (!splitMode.value || splitLayout.value !== "grid") return [];
  const ids = splitPaneTabIds.value;
  const layout = calcGridLayout(ids.length);
  const rows = [];
  let offset = 0;
  for (const cols of layout) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const globalIndex = offset + c;
      if (globalIndex < ids.length) {
        row.push({ tabId: ids[globalIndex], globalIndex });
      }
    }
    rows.push(row);
    offset += cols;
  }
  return rows;
});

function getTabById(tabId) {
  return openTabs.value.find((t) => t.id === tabId) || { id: tabId, _pendingOpen: false };
}

function selectPane(index) {
  layoutStore.activePaneIndex = index;
}

function fitAllTerminals() {
  if (!paneRefs.value) return;
  const refs = Array.isArray(paneRefs.value) ? paneRefs.value : [paneRefs.value];
  for (const pane of refs) {
    pane?.fit?.();
  }
}

watch(splitMode, async (val) => {
  await nextTick();
  fitAllTerminals();
});

defineExpose({ fitAllTerminals, selectPane });
</script>
