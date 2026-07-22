<template>
  <div
    class="empty-pane"
    :class="{ active: isActive }"
    @click="onPaneClick"
  >
    <div class="empty-pane-inner">
      <div class="empty-pane-title">Open a tab in this pane</div>
      <div v-if="openTabs.length === 0" class="empty-pane-hint">No open tabs</div>
      <ul v-else class="empty-pane-list">
        <li
          v-for="tab in openTabs"
          :key="tab.id"
          class="empty-pane-row"
          @click.stop="onSelectTab(tab.id)"
        >
          <span v-if="tab.wsIcon" v-html="renderIconStr(tab.wsIcon.name, tab.wsIcon.color, 14)"></span>
          <span v-if="tab.icon" v-html="renderIconStr(tab.icon.name, tab.icon.color, 14)"></span>
          <span class="empty-pane-row-name">{{ tab.workspace || tab.label || 'terminal' }}</span>
        </li>
      </ul>
      <div class="empty-pane-actions">
        <button type="button" class="empty-pane-action-btn" aria-label="Split horizontal" data-tooltip="Split horizontal" @click.stop="onSplit('horizontal')">
          <span class="mdi mdi-arrow-split-vertical"></span> Split horizontal
        </button>
        <button type="button" class="empty-pane-action-btn" aria-label="Split vertical" data-tooltip="Split vertical" @click.stop="onSplit('vertical')">
          <span class="mdi mdi-arrow-split-horizontal"></span> Split vertical
        </button>
      </div>
      <button type="button" class="empty-pane-stop-split" @click.stop="onStopSplit">
        <span class="mdi mdi-fullscreen"></span> Stop split
      </button>
    </div>

  </div>
</template>

<script setup>
import { computed } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { renderIconStr } from "../utils/render-icon.js";
import { isEmptyPaneId } from "../utils/empty-pane.js";

const props = defineProps({
  paneIndex: { type: Number, required: true },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

const openTabs = computed(() => {
  const occupied = new Set();
  const ids = layoutStore.splitPaneTabIds || [];
  ids.forEach((id, idx) => {
    if (idx === props.paneIndex) return;
    if (id == null || isEmptyPaneId(id)) return;
    occupied.add(id);
  });
  return terminalStore.openTabs.filter((t) => !occupied.has(t.id));
});
const isActive = computed(() => layoutStore.activePaneIndex === props.paneIndex);

function onPaneClick() {
  if (!isActive.value) emits("select-pane", props.paneIndex);
}

function onSelectTab(tabId) {
  layoutStore.assignTabToPane(props.paneIndex, tabId);
  terminalStore.switchTab(tabId);
}

function onStopSplit() {
  layoutStore.exitSplitMode();
}

function onSplit(direction) {
  layoutStore.splitEmptyPane(props.paneIndex, direction);
}
</script>

<style scoped>
.empty-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  border: 1px solid var(--border);
  background: var(--bg-secondary, #1a1b26);
  overflow: hidden;
  position: relative;
}

.empty-pane.active {
  border-color: var(--accent);
}

.empty-pane-inner {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow: auto;
  min-height: 0;
}

.empty-pane-title {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.empty-pane-hint {
  color: var(--text-muted);
  font-size: 13px;
  padding: 8px 0;
}

.empty-pane-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.empty-pane-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 6px);
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  min-width: 0;
}

.empty-pane-row:active {
  transform: scale(0.98);
}

.empty-pane-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-pane-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.empty-pane-action-btn,
.empty-pane-stop-split {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 6px);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}

.empty-pane-action-btn {
  flex: 1;
  min-width: 0;
}

.empty-pane-stop-split {
  margin-top: 0;
}

.empty-pane-action-btn:active,
.empty-pane-stop-split:active {
  transform: scale(0.98);
}

@media (hover: hover) and (pointer: fine) {
  .empty-pane-row:hover {
    border-color: var(--accent);
  }

  .empty-pane-action-btn:hover,
  .empty-pane-stop-split:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }
}
</style>
