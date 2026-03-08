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
          :class="{ active: !splitMode && tab.id === activeTabId }"
        >
          <span class="split-tab-drag-handle">
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
            <span v-if="tab.wsIcon" v-html="renderIcon(tab.wsIcon.name, tab.wsIcon.color, 14)"></span>
            <span v-if="tab.icon" v-html="renderIcon(tab.icon.name, tab.icon.color, 14)"></span>
            {{ tabDisplayName(tab) }}
          </span>
          <button type="button" class="split-tab-close-btn" @click.stop="onClose(tab)">&times;</button>
        </div>
        <div v-if="openTabs.length === 0" class="clone-repo-empty">開いているタブはありません</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const openTabs = computed(() => terminalStore.openTabs);
const activeTabId = computed(() => terminalStore.activeTabId);
const splitMode = computed(() => layoutStore.splitMode);
const splitPaneTabIds = computed(() => layoutStore.splitPaneTabIds);

const modes = [
  { value: "normal", icon: "split-icon-normal", minTabs: 0 },
  { value: "vertical", icon: "split-icon-v", minTabs: 2 },
  { value: "horizontal", icon: "split-icon-h", minTabs: 2 },
  { value: "grid", icon: "split-icon-grid", minTabs: 3 },
];

const currentMode = computed(() => {
  if (!splitMode.value) return "normal";
  return layoutStore.splitLayout || "vertical";
});

function renderIcon(icon, color, size) {
  return renderIconStr(icon, color, size);
}

function tabDisplayName(tab) {
  return tab.workspace || tab.label || "";
}

function setMode(mode) {
  if (mode === "normal") {
    if (splitMode.value) layoutStore.exitSplitMode();
  } else {
    layoutStore.splitLayout = mode;
    if (!splitMode.value) {
      enterSplitWithAllTabs();
    }
  }
}

function enterSplitWithAllTabs() {
  if (openTabs.value.length < 2) return;
  layoutStore.splitPaneTabIds = openTabs.value.map((t) => t.id);
  layoutStore.activePaneIndex = 0;
  layoutStore.splitMode = true;
}

function onRadioClick(tab) {
  if (splitMode.value) {
    layoutStore.exitSplitMode();
  }
  emit("tab:select", { tab });
}

function onCheckboxClick(tab) {
  if (splitMode.value) {
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
    layoutStore.splitMode = true;
  }
}

function onInfoClick(tab) {
  if (splitMode.value) {
    layoutStore.exitSplitMode();
  }
  emit("tab:select", { tab });
}

function onClose(tab) {
  terminalStore.removeTab(tab.id);
  if (splitMode.value) {
    layoutStore.splitPaneTabIds = layoutStore.splitPaneTabIds.filter((id) => id !== tab.id);
    if (layoutStore.splitPaneTabIds.length < 2) {
      layoutStore.exitSplitMode();
    }
  }
}
</script>
