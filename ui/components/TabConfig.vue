<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <SplitModeSelector
        :current-mode="currentMode"
        :tab-count="openTabs.length"
        @select="setMode"
      />

      <div class="split-tab-list">
        <div
          v-for="(tab, idx) in openTabs"
          :key="tab.id"
          class="split-tab-row"
          :class="{
            active: !isSplitMode && tab.id === activeTabId,
            hidden: tab.hidden,
            'drag-source': dragFromIdx === idx,
            'drag-over-above': dragOverIdx === idx && dragFromIdx > idx,
            'drag-over-below': dragOverIdx === idx && dragFromIdx < idx,
          }"
        >
          <span
            class="drag-handle"
            @touchstart.passive="onDragStart($event, idx)"
            @mousedown="onDragStart($event, idx)"
          >
            <span class="mdi mdi-drag"></span>
          </span>
          <span class="split-tab-input-wrap">
            <input
              type="radio"
              class="split-tab-input"
              :checked="tab.id === activeTabId"
              @click.stop="onRadioClick(tab)"
            />
            <input
              type="checkbox"
              class="split-tab-input"
              :checked="splitPaneTabIds.includes(tab.id)"
              @click.stop="onCheckboxClick(tab)"
            />
          </span>
          <span class="split-tab-row-info" @click.stop="onInfoClick(tab)">
            <span v-if="tab.wsIcon" v-html="renderIconStr(tab.wsIcon.name, tab.wsIcon.color, 14)"></span>
            <span v-if="tab.icon" v-html="renderIconStr(tab.icon.name, tab.icon.color, 14)"></span>
            <span class="split-tab-row-name">{{ tabDisplayName(tab) }}</span>
            <span v-if="tab.hidden" class="split-tab-row-badge">Hidden</span>
          </span>
          <button type="button" class="split-tab-close-btn" @click.stop="onClose(tab)">&times;</button>
        </div>
        <div v-if="openTabs.length === 0" class="clone-repo-empty">No open tabs</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { inject, computed } from "vue";
import SplitModeSelector from "./SplitModeSelector.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useListDragSort } from "../composables/useListDragSort.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Tabs";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const { confirm } = useConfirm();

const openTabs = computed(() => terminalStore.openTabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const isSplitMode = computed(() => layoutStore.isSplitMode);
const splitPaneTabIds = computed(() => layoutStore.splitPaneTabIds);

const currentMode = computed(() => {
  if (!isSplitMode.value) return "normal";
  return layoutStore.splitLayout || "vertical";
});

function tabDisplayName(tab) {
  return tab.workspace || tab.label || "";
}

function setMode(mode) {
  if (mode === "normal") {
    if (isSplitMode.value) layoutStore.exitSplitMode();
  } else {
    layoutStore.splitLayout = mode;
    if (!isSplitMode.value) {
      enterSplitWithAllTabs();
    }
  }
}

function enterSplitWithAllTabs() {
  if (openTabs.value.length < 2) return;
  layoutStore.splitPaneTabIds = openTabs.value.map((t) => t.id);
  layoutStore.activePaneIndex = 0;
  layoutStore.isSplitMode = true;
}

function onRadioClick(tab) {
  if (isSplitMode.value) {
    layoutStore.exitSplitMode();
  }
  emit("tab:select", { tab });
}

function onCheckboxClick(tab) {
  if (isSplitMode.value) {
    const included = layoutStore.splitPaneTabIds.includes(tab.id);
    if (included) {
      layoutStore.splitPaneTabIds = layoutStore.splitPaneTabIds.filter((id) => id !== tab.id);
      if (layoutStore.splitLayout === "grid" && layoutStore.splitPaneTabIds.length < 3) {
        layoutStore.splitLayout = "vertical";
      }
      if (layoutStore.splitPaneTabIds.length < 2) {
        layoutStore.exitSplitMode();
      }
    } else {
      layoutStore.splitPaneTabIds = [...layoutStore.splitPaneTabIds, tab.id];
    }
  } else {
    if (tab.id === activeTabId.value) return;
    layoutStore.splitLayout = "vertical";
    layoutStore.splitPaneTabIds = [activeTabId.value, tab.id];
    layoutStore.activePaneIndex = 0;
    layoutStore.isSplitMode = true;
  }
}

function onInfoClick(tab) {
  if (isSplitMode.value) {
    layoutStore.exitSplitMode();
  }
  emit("tab:select", { tab });
}

async function onClose(tab) {
  const label = tab.workspace || tab.label || "terminal";
  if (await confirm(`Close "${label}" tab?`)) {
    emit("tab:close", { tab });
  }
}

const { dragFromIdx, dragOverIdx, onDragStart } = useListDragSort({
  rowSelector: ".split-tab-row",
  onReorder: (fromIdx, toIdx) => terminalStore.moveTab(fromIdx, toIdx),
});
</script>

<style scoped>
.split-tab-content {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-height: 0;
  overflow: visible;
}

.split-tab-scroll {
  padding-top: 4px;
}

.split-tab-list {
  overflow: visible;
  flex: 0 0 auto;
}

.split-tab-row {
  display: flex;
  align-items: center;
  padding: 10px 8px;
  border-bottom: 1px solid var(--border);
  gap: 8px;
  cursor: pointer;
  width: 100%;
  box-sizing: border-box;
}

.split-tab-row.active {
  background: var(--bg-tertiary);
}

.split-tab-row.drag-source {
  opacity: 0.4;
}

.split-tab-row.drag-over-above {
  border-top: 2px solid var(--accent);
}

.split-tab-row.drag-over-below {
  border-bottom: 2px solid var(--accent);
}

.split-tab-row.dragging {
  opacity: 0.7;
  background: var(--bg-tertiary);
}

.split-tab-row.hidden .split-tab-row-name {
  color: var(--text-muted);
  font-style: italic;
}

.split-tab-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.split-tab-row-badge {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1px 6px;
  margin-left: 4px;
}

.split-tab-row-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.split-tab-input-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  width: 76px;
  cursor: pointer;
}

.split-tab-input {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border: 2px solid var(--text-muted);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  margin: 0;
  pointer-events: auto;
  opacity: 1;
}

.split-tab-input:checked {
  border-color: var(--accent);
  background: var(--accent);
}

.split-tab-input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 5px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid var(--bg-primary);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.split-tab-input[type="radio"] {
  border-radius: 50%;
}

.split-tab-input:disabled {
  opacity: 0.45;
  cursor: default;
}

.split-tab-input[type="radio"]:checked::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bg-primary);
}

.split-tab-close-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>
