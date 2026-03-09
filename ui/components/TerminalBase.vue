<template>
  <div
    class="output-container"
    :class="[splitContainerClasses, { 'input-overlay-active': keyboardOverlay }]"
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
      <div class="split-drop-zone drop-center" @dragover.prevent @dragenter.prevent="onDragEnter" @dragleave="onDragLeave" @drop="onDrop($event, 'center')">
        <span class="mdi mdi-fullscreen drop-zone-icon"></span>
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
    <div class="terminal-keyboard-overlay">
      <KeyboardBase
        ref="keyboardBase"
        :is-panel-bottom="isPanelBottom"
        @visibility="onKeyboardInputVisibility"
      />
    </div>
    <slot />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from "vue";
import TerminalPane from "./TerminalPane.vue";
import KeyboardBase from "./KeyboardBase.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { on } from "../app-bridge.js";

defineProps({
  isPanelBottom: { type: Boolean, default: false },
});
const emit = defineEmits(["keyboardInputVisibility"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const keyboardOverlay = ref(false);
on("keyboard:modeChange", ({ mode }) => { keyboardOverlay.value = mode === 1; });
const keyboardBase = ref(null);

const paneRefs = ref([]);

const openTabs = computed(() => terminalStore.openTabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const isSplitMode = computed(() => layoutStore.isSplitMode);
const splitLayout = computed(() => layoutStore.splitLayout || "horizontal");
const splitPaneTabIds = computed(() => layoutStore.splitPaneTabIds);
const activePaneIndex = computed(() => layoutStore.activePaneIndex);
const isShowDropZones = computed(() => layoutStore.isShowDropZones);
const isPanelBottom = computed(() => layoutStore.isPanelBottom);

function onDragEnter(e) {
  e.currentTarget.classList.add("drag-over");
}

function onDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function onDrop(e, direction) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  layoutStore.isShowDropZones = false;
  const raw = layoutStore.dragTabId || e.dataTransfer.getData("text/plain");
  const tabId = typeof raw === "string" ? parseInt(raw, 10) : raw;
  if (tabId) {
    layoutStore.splitWithDrop(tabId, direction, terminalStore.openTabs, terminalStore.activeTabId);
  }
  layoutStore.dragTabId = null;
}

const splitContainerClasses = computed(() => {
  if (!isSplitMode.value) return {};
  return {
    "split-active": true,
    [`split-${splitLayout.value}`]: true,
    "split-mobile": layoutStore.isPanelBottom,
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
  if (!isSplitMode.value || splitLayout.value !== "grid") return [];
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

function onKeyboardInputVisibility(visible) {
  emit("keyboardInputVisibility", !!visible);
}

function showKeyboardInput() {
  keyboardBase.value?.showInput?.();
}

function hideKeyboardInput() {
  keyboardBase.value?.hideInput?.();
}

watch(isSplitMode, async () => {
  await nextTick();
  requestAnimationFrame(() => fitAllTerminals());
});

watch(activeTabId, async (id) => {
  if (isSplitMode.value) return;
  await nextTick();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!paneRefs.value) return;
      const refs = Array.isArray(paneRefs.value) ? paneRefs.value : [paneRefs.value];
      const active = refs.find((p) => p?.tabId === id);
      active?.fit?.({ force: true });
    });
  });
});

defineExpose({ fitAllTerminals, selectPane, showKeyboardInput, hideKeyboardInput });
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

.output-container.input-overlay-active::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--overlay-bg);
  z-index: 5;
  pointer-events: none;
  touch-action: none;
}

.terminal-keyboard-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  pointer-events: auto;
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

.split-pane.active-pane :deep(.tab-name-pill) {
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
  top: 25%;
  left: 25%;
  right: 25%;
  bottom: 25%;
  border: 2px dashed rgba(130, 170, 255, 0.3);
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
    left: 0;
    right: 0;
    top: 30%;
    bottom: 30%;
  }
}
</style>
