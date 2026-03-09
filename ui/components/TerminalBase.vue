<template>
  <div
    class="output-container"
    :class="[splitContainerClasses, { 'input-overlay-active': keyboardOverlay }]"
    ref="containerEl"
  >
    <div v-if="showDropZones" class="split-drop-overlay">
      <template v-if="!panelBottom">
        <div class="split-drop-zone drop-left" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'left')">
          <span class="mdi mdi-arrow-left drop-zone-icon"></span>
        </div>
        <div class="split-drop-zone drop-right" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'right')">
          <span class="mdi mdi-arrow-right drop-zone-icon"></span>
        </div>
      </template>
      <div class="split-drop-zone drop-top" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'top')">
        <span class="mdi mdi-arrow-up drop-zone-icon"></span>
      </div>
      <div class="split-drop-zone drop-bottom" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'bottom')">
        <span class="mdi mdi-arrow-down drop-zone-icon"></span>
      </div>
      <div class="split-drop-zone drop-center" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'center')">
        <span class="mdi mdi-fullscreen drop-zone-icon"></span>
      </div>
    </div>

    <EmptyPane v-if="openTabs.length === 0 && !splitMode" @openWorkspace="openWorkspaceModal" />

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
    <slot />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from "vue";
import TerminalPane from "./TerminalPane.vue";
import EmptyPane from "./EmptyPane.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { emit, on } from "../app-bridge.js";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const keyboardOverlay = ref(false);
on("keyboard:modeChange", ({ mode }) => { keyboardOverlay.value = mode === 1; });

function openWorkspaceModal() {
  emit("workspace:openModal");
}

const containerEl = ref(null);
const paneRefs = ref([]);

const openTabs = computed(() => terminalStore.openTabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const splitMode = computed(() => layoutStore.splitMode);
const splitLayout = computed(() => layoutStore.splitLayout || "horizontal");
const splitPaneTabIds = computed(() => layoutStore.splitPaneTabIds);
const activePaneIndex = computed(() => layoutStore.activePaneIndex);
const showDropZones = computed(() => layoutStore.showDropZones);
const panelBottom = computed(() => layoutStore.panelBottom);

function onDragEnter(e) {
  e.currentTarget.classList.add("drag-over");
}

function onDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function onDrop(e, direction) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  layoutStore.showDropZones = false;
  const raw = layoutStore.dragTabId || e.dataTransfer.getData("text/plain");
  const tabId = typeof raw === "string" ? parseInt(raw, 10) : raw;
  if (tabId) {
    layoutStore.splitWithDrop(tabId, direction, terminalStore.openTabs, terminalStore.activeTabId);
  }
  layoutStore.dragTabId = null;
}

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

function fitAllTerminals(opts) {
  if (!paneRefs.value) return;
  const refs = Array.isArray(paneRefs.value) ? paneRefs.value : [paneRefs.value];
  for (const pane of refs) {
    pane?.fit?.(opts);
  }
}

watch(splitMode, async () => {
  await nextTick();
  requestAnimationFrame(() => fitAllTerminals());
});

watch(activeTabId, async (id) => {
  if (splitMode.value) return;
  await nextTick();
  requestAnimationFrame(() => {
    if (!paneRefs.value) return;
    const refs = Array.isArray(paneRefs.value) ? paneRefs.value : [paneRefs.value];
    const active = refs.find((p) => p?.tabId === id);
    active?.fit?.();
  });
});

defineExpose({ fitAllTerminals, selectPane });
</script>
