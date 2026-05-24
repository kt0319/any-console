<template>
  <div
    class="output-container"
    :class="splitContainerClasses"
  >
    <div v-if="isShowDropZones" class="split-drop-overlay">
      <div class="split-drop-zone drop-top-left" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'top-left')">
        <span class="drop-zone-grid-icon" aria-hidden="true">
          <span class="cell tl"></span>
          <span class="cell tr"></span>
          <span class="cell bl"></span>
          <span class="cell br"></span>
        </span>
      </div>
      <div class="split-drop-zone drop-top-right" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'top-right')">
        <span class="drop-zone-grid-icon" aria-hidden="true">
          <span class="cell tl"></span>
          <span class="cell tr"></span>
          <span class="cell bl"></span>
          <span class="cell br"></span>
        </span>
      </div>
      <div class="split-drop-zone drop-bottom-left" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'bottom-left')">
        <span class="drop-zone-grid-icon" aria-hidden="true">
          <span class="cell tl"></span>
          <span class="cell tr"></span>
          <span class="cell bl"></span>
          <span class="cell br"></span>
        </span>
      </div>
      <div class="split-drop-zone drop-bottom-right" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'bottom-right')">
        <span class="drop-zone-grid-icon" aria-hidden="true">
          <span class="cell tl"></span>
          <span class="cell tr"></span>
          <span class="cell bl"></span>
          <span class="cell br"></span>
        </span>
      </div>
      <template v-if="!isPanelBottom">
        <div class="split-drop-zone drop-left" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'left')">
          <span class="drop-zone-rect-icon rect-left" aria-hidden="true">
            <span class="rect r1"></span>
            <span class="rect r2"></span>
          </span>
        </div>
        <div class="split-drop-zone drop-right" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'right')">
          <span class="drop-zone-rect-icon rect-right" aria-hidden="true">
            <span class="rect r1"></span>
            <span class="rect r2"></span>
          </span>
        </div>
      </template>
      <div class="split-drop-zone drop-top" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'top')">
        <span class="drop-zone-rect-icon rect-top" aria-hidden="true">
          <span class="rect r1"></span>
          <span class="rect r2"></span>
        </span>
      </div>
      <div class="split-drop-zone drop-bottom" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'bottom')">
        <span class="drop-zone-rect-icon rect-bottom" aria-hidden="true">
          <span class="rect r1"></span>
          <span class="rect r2"></span>
        </span>
      </div>
      <div v-if="isSplitMode" class="split-drop-zone drop-center" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'center')">
        <span class="mdi mdi-fullscreen drop-zone-icon"></span>
        <span class="drop-zone-label">Exit split mode</span>
      </div>
    </div>

    <template v-if="!isSplitMode">
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
          <template v-for="pane in row" :key="pane.tabId">
            <EmptyPane
              v-if="isEmptyPaneId(pane.tabId)"
              :pane-index="pane.globalIndex"
              :class="['split-pane', 'pane-' + pane.globalIndex, { 'active-pane': pane.globalIndex === activePaneIndex }]"
              @select-pane="selectPane"
            />
            <TerminalPane
              v-else
              :tab="getTabById(pane.tabId)"
              :pane-index="pane.globalIndex"
              :class="['split-pane', 'pane-' + pane.globalIndex, { 'active-pane': pane.globalIndex === activePaneIndex }]"
              @select-pane="selectPane"
              ref="paneRefs"
            />
          </template>
        </div>
      </template>
      <template v-else>
        <template v-for="(tabId, idx) in splitPaneTabIds" :key="tabId">
          <EmptyPane
            v-if="isEmptyPaneId(tabId)"
            :pane-index="idx"
            :class="['split-pane', 'pane-' + idx, { 'active-pane': idx === activePaneIndex }]"
            @select-pane="selectPane"
          />
          <TerminalPane
            v-else
            :tab="getTabById(tabId)"
            :pane-index="idx"
            :class="['split-pane', 'pane-' + idx, { 'active-pane': idx === activePaneIndex }]"
            @select-pane="selectPane"
            ref="paneRefs"
          />
        </template>
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
import { buildGridRows } from "../utils/terminal-layout.js";
import { isEmptyPaneId } from "../utils/empty-pane.js";
import { useTerminalDrop } from "../composables/useTerminalDrop.js";

defineProps({
  isPanelBottom: { type: Boolean, default: false },
});

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const paneRefs = ref([]);

const openTabs = computed(() => terminalStore.openTabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const isSplitMode = computed(() => layoutStore.isSplitMode);
const splitLayout = computed(() => layoutStore.splitLayout || "horizontal");
const splitPaneTabIds = computed(() => layoutStore.splitPaneTabIds);
const activePaneIndex = computed(() => layoutStore.activePaneIndex);
const isShowDropZones = computed(() => layoutStore.isShowDropZones);
const isPanelBottom = computed(() => layoutStore.isPanelBottom);

const { onDragEnter, onDragLeave, onDrop } = useTerminalDrop();

const splitContainerClasses = computed(() => {
  if (!isSplitMode.value) return {};
  return {
    "split-active": true,
    [`split-${splitLayout.value}`]: true,
    "split-mobile": layoutStore.isPanelBottom,
  };
});

const gridRows = computed(() => {
  if (!isSplitMode.value || splitLayout.value !== "grid") return [];
  return buildGridRows(splitPaneTabIds.value);
});

function getTabById(tabId) {
  return openTabs.value.find((t) => t.id === tabId) || { id: tabId, _pendingOpen: false };
}

function selectPane(index) {
  layoutStore.activePaneIndex = index;
  const tabId = layoutStore.splitPaneTabIds[index];
  if (tabId != null && !isEmptyPaneId(tabId)) {
    terminalStore.switchTab(tabId);
  }
}

function fitAllTerminals(opts) {
  if (!paneRefs.value) return;
  const refs = Array.isArray(paneRefs.value) ? paneRefs.value : [paneRefs.value];
  const visibleTabIds = new Set();
  if (isSplitMode.value) {
    for (const id of splitPaneTabIds.value || []) {
      if (id != null && !isEmptyPaneId(id)) visibleTabIds.add(id);
    }
  } else if (activeTabId.value != null) {
    visibleTabIds.add(activeTabId.value);
  }
  for (const pane of refs) {
    if (!visibleTabIds.has(pane?.tabId)) continue;
    pane?.fit?.(opts);
  }
}

watch(isSplitMode, async () => {
  await nextTick();
  requestAnimationFrame(() => fitAllTerminals());
});



defineExpose({ fitAllTerminals, selectPane });
</script>

<style scoped>
.output-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.output-container.split-active {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.output-container.split-active > :deep(.output-area),
.output-container.split-active > :deep(.terminal-frame) {
  display: none;
}

.split-row {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  gap: 2px;
}

.split-pane {
  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  flex: 1;
  border: 1px solid var(--border);
}

.split-pane :deep(.terminal-frame),
.split-pane :deep(.output-area) {
  position: absolute;
  inset: 0;
}

.split-pane.active-pane :deep(.terminal-info-pill) {
  border-color: var(--accent);
}

.output-container.split-mobile {
  flex-direction: column;
}

.output-container.split-mobile > .split-pane {
  flex: 1;
  min-height: 0;
}

.output-container.split-vertical {
  flex-direction: column;
}

.output-container.split-vertical > .split-pane {
  flex: 1;
  min-height: 0;
}

.output-container.split-horizontal {
  flex-direction: row;
}

.output-container.split-horizontal > .split-pane {
  flex: 1;
  min-width: 0;
}

.split-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  pointer-events: none;
}

.split-drop-zone {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  background: rgba(130, 170, 255, 0.08);
  border: 2px dashed rgba(130, 170, 255, 0.3);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.split-drop-zone.drop-left,
.split-drop-zone.drop-right {
  top: 0;
  bottom: 0;
  width: 25%;
}

.split-drop-zone.drop-top-left,
.split-drop-zone.drop-top-right,
.split-drop-zone.drop-bottom-left,
.split-drop-zone.drop-bottom-right {
  width: 18%;
  height: 18%;
}

.split-drop-zone.drop-top-left { top: 0; left: 0; }
.split-drop-zone.drop-top-right { top: 0; right: 0; }
.split-drop-zone.drop-bottom-left { bottom: 0; left: 0; }
.split-drop-zone.drop-bottom-right { right: 0; bottom: 0; }

.split-drop-zone.drop-left {
  left: 0;
  border-right-style: dashed;
  border-left: none;
  border-top: none;
  border-bottom: none;
}

.split-drop-zone.drop-right {
  right: 0;
  border-left-style: dashed;
  border-right: none;
  border-top: none;
  border-bottom: none;
}

.split-drop-zone.drop-top,
.split-drop-zone.drop-bottom {
  left: 25%;
  right: 25%;
  height: 25%;
}

.split-drop-zone.drop-top {
  top: 0;
  border-bottom-style: dashed;
  border-top: none;
  border-left: none;
  border-right: none;
}

.split-drop-zone.drop-bottom {
  bottom: 0;
  border-top-style: dashed;
  border-bottom: none;
  border-left: none;
  border-right: none;
}

.split-drop-zone.drop-center {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 140px;
  height: 64px;
  right: auto;
  bottom: auto;
  flex-direction: column;
  gap: 4px;
  border-radius: 8px;
  background: rgba(130, 170, 255, 0.08);
  border: 2px dashed rgba(130, 170, 255, 0.35);
}

.split-drop-zone.drop-center .drop-zone-icon {
  color: rgba(130, 170, 255, 0.5);
}

.split-drop-zone.drop-center .drop-zone-label {
  font-size: 11px;
  color: rgba(130, 170, 255, 0.7);
  letter-spacing: 0.3px;
  text-transform: none;
  white-space: nowrap;
  transition: color 0.15s ease;
}

.split-drop-zone.drag-over.drop-center {
  background: rgba(130, 170, 255, 0.18);
  border-color: var(--accent);
}

.split-drop-zone.drag-over.drop-center .drop-zone-icon,
.split-drop-zone.drag-over.drop-center .drop-zone-label {
  color: var(--accent);
}

.split-drop-zone.drag-over {
  background: rgba(130, 170, 255, 0.2);
  border-color: var(--accent);
}

.split-drop-zone .drop-zone-icon {
  font-size: 24px;
  color: rgba(130, 170, 255, 0.4);
  transition: color 0.15s ease;
}

.split-drop-zone.drag-over .drop-zone-icon {
  color: var(--accent);
}

.drop-zone-grid-icon {
  display: grid;
  grid-template-columns: repeat(2, 9px);
  grid-template-rows: repeat(2, 9px);
  gap: 3px;
}

.drop-zone-grid-icon .cell {
  width: 9px;
  height: 9px;
  border: 1px solid rgba(130, 170, 255, 0.6);
  background: transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.split-drop-zone.drop-top-left .drop-zone-grid-icon .cell.tl,
.split-drop-zone.drop-top-right .drop-zone-grid-icon .cell.tr,
.split-drop-zone.drop-bottom-left .drop-zone-grid-icon .cell.bl,
.split-drop-zone.drop-bottom-right .drop-zone-grid-icon .cell.br {
  background: rgba(130, 170, 255, 0.45);
}

.split-drop-zone.drag-over .drop-zone-grid-icon .cell {
  border-color: var(--accent);
}

.split-drop-zone.drag-over.drop-top-left .drop-zone-grid-icon .cell.tl,
.split-drop-zone.drag-over.drop-top-right .drop-zone-grid-icon .cell.tr,
.split-drop-zone.drag-over.drop-bottom-left .drop-zone-grid-icon .cell.bl,
.split-drop-zone.drag-over.drop-bottom-right .drop-zone-grid-icon .cell.br {
  background: var(--accent);
}

.drop-zone-rect-icon {
  position: relative;
  display: block;
  width: 26px;
  height: 20px;
}

.drop-zone-rect-icon .rect {
  position: absolute;
  border: 1px solid rgba(130, 170, 255, 0.6);
  border-radius: 2px;
  background: transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.split-drop-zone.drag-over .drop-zone-rect-icon .rect {
  border-color: var(--accent);
}

.rect-left .r1,
.rect-right .r1 {
  top: 2px;
  width: 10px;
  height: 16px;
  background: rgba(130, 170, 255, 0.45);
}

.rect-left .r1 { left: 2px; }
.rect-right .r1 { right: 2px; }

.rect-left .r2,
.rect-right .r2 {
  top: 2px;
  width: 10px;
  height: 16px;
}

.rect-left .r2 { right: 2px; }
.rect-right .r2 { left: 2px; }

.rect-top .r1,
.rect-bottom .r1 {
  left: 2px;
  width: 22px;
  height: 7px;
  background: rgba(130, 170, 255, 0.45);
}

.rect-top .r1 { top: 2px; }
.rect-bottom .r1 { bottom: 2px; }

.rect-top .r2,
.rect-bottom .r2 {
  left: 2px;
  width: 22px;
  height: 7px;
}

.rect-top .r2 { bottom: 2px; }
.rect-bottom .r2 { top: 2px; }

.rect-center .r1 {
  left: 4px;
  top: 5px;
  width: 18px;
  height: 10px;
  background: rgba(130, 170, 255, 0.3);
}

.split-drop-zone.drag-over .rect-left .r1,
.split-drop-zone.drag-over .rect-right .r1,
.split-drop-zone.drag-over .rect-top .r1,
.split-drop-zone.drag-over .rect-bottom .r1,
.split-drop-zone.drag-over .rect-center .r1 {
  background: var(--accent);
}

@media (max-width: 768px) {
  .split-drop-zone.drop-top-left,
  .split-drop-zone.drop-top-right,
  .split-drop-zone.drop-bottom-left,
  .split-drop-zone.drop-bottom-right {
    display: none;
  }

  .split-drop-zone.drop-top,
  .split-drop-zone.drop-bottom {
    left: 0;
    right: 0;
    height: 30%;
  }

  .split-drop-zone.drop-center {
    left: 50%;
    right: auto;
    top: 50%;
    bottom: auto;
    width: 140px;
    height: 64px;
    transform: translate(-50%, -50%);
  }
}
</style>
