<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <div class="split-tab-mode-row">
        <button
          v-for="m in modes"
          :key="m.value"
          type="button"
          class="split-tab-mode-option"
          :class="{ active: currentMode === m.value }"
          :disabled="m.minTabs > openTabs.length"
          @click="setMode(m.value)"
        >
          <span :class="m.icon"></span>
        </button>
      </div>

      <div class="split-tab-list">
        <div
          v-for="(tab, idx) in openTabs"
          :key="tab.id"
          class="split-tab-row"
          :class="{
            active: !isSplitMode && tab.id === activeTabId,
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
            {{ tabDisplayName(tab) }}
          </span>
          <button type="button" class="split-tab-close-btn" @click.stop="onClose(tab)">&times;</button>
        </div>
        <div v-if="openTabs.length === 0" class="clone-repo-empty">No open tabs</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, computed, onBeforeUnmount } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Tabs";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const openTabs = computed(() => terminalStore.openTabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const isSplitMode = computed(() => layoutStore.isSplitMode);
const splitPaneTabIds = computed(() => layoutStore.splitPaneTabIds);

const modes = [
  { value: "normal", icon: "split-icon-normal", minTabs: 0 },
  { value: "vertical", icon: "split-icon-v", minTabs: 2 },
  { value: "horizontal", icon: "split-icon-h", minTabs: 2 },
  { value: "grid", icon: "split-icon-grid", minTabs: 3 },
];

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

function onClose(tab) {
  emit("tab:close", { tab });
}

const dragFromIdx = ref(null);
const dragOverIdx = ref(null);

function onDragStart(e, idx) {
  dragFromIdx.value = idx;
  dragOverIdx.value = idx;
  const isTouch = e.type === "touchstart";
  const moveEvent = isTouch ? "touchmove" : "mousemove";
  const endEvent = isTouch ? "touchend" : "mouseup";

  function getY(ev) {
    return isTouch ? ev.touches[0].clientY : ev.clientY;
  }

  function onMove(ev) {
    const y = isTouch ? ev.touches[0].clientY : ev.clientY;
    const rows = document.querySelectorAll(".split-tab-row");
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom) {
        dragOverIdx.value = i;
        break;
      }
    }
    if (isTouch) ev.preventDefault();
  }

  function onEnd() {
    document.removeEventListener(moveEvent, onMove, { passive: false });
    document.removeEventListener(endEvent, onEnd);
    if (dragFromIdx.value !== null && dragOverIdx.value !== null && dragFromIdx.value !== dragOverIdx.value) {
      terminalStore.moveTab(dragFromIdx.value, dragOverIdx.value);
    }
    dragFromIdx.value = null;
    dragOverIdx.value = null;
  }

  document.addEventListener(moveEvent, onMove, { passive: false });
  document.addEventListener(endEvent, onEnd);
}

onBeforeUnmount(() => {
  dragFromIdx.value = null;
  dragOverIdx.value = null;
});
</script>

<style scoped>
.split-tab-mode-row {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  flex-shrink: 0;
  margin-bottom: 8px;
}

.split-tab-mode-option {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
}

.split-tab-mode-option.active {
  background: var(--accent);
  color: var(--bg-primary);
}

.split-tab-mode-option:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

[class^="split-icon-"] {
  display: inline-block;
  width: 16px;
  height: 14px;
  vertical-align: middle;
  border: 1.5px solid currentColor;
  border-radius: 1px;
  position: relative;
}

.split-icon-h::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: currentColor;
  transform: translateX(-50%);
}

.split-icon-v::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1.5px;
  background: currentColor;
  transform: translateY(-50%);
}

.split-icon-grid::before,
.split-icon-grid::after {
  content: "";
  position: absolute;
  background: currentColor;
}

.split-icon-grid::before {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1.5px;
  transform: translateX(-50%);
}

.split-icon-grid::after {
  top: 50%;
  left: 0;
  right: 0;
  height: 1.5px;
  transform: translateY(-50%);
}

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
