<template>
  <div
    class="empty-pane"
    :class="{ active: isActive }"
    @click="onPaneClick"
  >
    <div class="empty-pane-inner">
      <div class="empty-pane-title-row">
        <div class="empty-pane-title">Open a tab in this pane</div>
        <button type="button" class="empty-pane-close-btn" aria-label="Remove pane" data-tooltip="Remove pane" @click.stop="onRemovePane">
          <span class="mdi mdi-close"></span>
        </button>
      </div>
      <SplitModeSelector
        :current-mode="currentMode"
        :tab-count="tabCount"
        @select="onSelectMode"
        @click.stop
      />
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
        <button type="button" class="empty-pane-action-btn" aria-label="Add workspace" data-tooltip="Add workspace" @click.stop="onAddWorkspace">
          <span class="mdi mdi-folder-plus-outline"></span> Add workspace
        </button>
        <button type="button" class="empty-pane-action-btn" :disabled="!canAddPane" aria-label="Add pane" data-tooltip="Add pane" @click.stop="onAddPane">
          <span class="mdi mdi-plus-box-outline"></span> Add pane
        </button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { computed } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { renderIconStr } from "../utils/render-icon.js";
import { isEmptyPaneId } from "../utils/empty-pane.js";
import { emit } from "../app-bridge.js";
import SplitModeSelector from "./SplitModeSelector.vue";

const props = defineProps({
  paneIndex: { type: Number, required: true },
});

const emits = defineEmits(["select-pane"]);

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();

// tab は markRaw のため tab.workspace 単体の変更は追跡されない。Add で
// ベアターミナルにワークスペースを紐付けた直後もタブ名に反映されるよう、
// tabWorkspaceVersion を読んで依存に含める。
const openTabs = computed(() => {
  terminalStore.tabWorkspaceVersion;
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
const currentMode = computed(() => layoutStore.splitLayout || "vertical");
const tabCount = computed(() => terminalStore.openTabs.length);
// ペイン数がタブ数以上だと、これ以上増やしても埋められないペインができるだけなので押せなくする。
const canAddPane = computed(() => layoutStore.splitPaneTabIds.length < tabCount.value);

function onPaneClick() {
  if (!isActive.value) emits("select-pane", props.paneIndex);
}

function onSelectTab(tabId) {
  layoutStore.assignTabToPane(props.paneIndex, tabId);
  terminalStore.switchTab(tabId);
}

function onSelectMode(mode) {
  if (mode === "normal") {
    layoutStore.exitSplitMode();
    return;
  }
  layoutStore.splitLayout = mode;
}

function onAddPane() {
  layoutStore.addPane(props.paneIndex);
}

function onAddWorkspace() {
  emit("workspace:openAdd");
}

function onRemovePane() {
  // 分割解除が発生する場合の復帰先タブへの切り替えは layoutStore.removeEmptyPane
  // （内部で exitSplitMode 経由）が保証するので、ここで別途 switchTab する必要はない。
  layoutStore.removeEmptyPane(props.paneIndex);
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
  border: 1px solid #2a2e42;
  background: var(--bg-secondary, #1a1b26);
  overflow: hidden;
  position: relative;
}

.empty-pane.active {
  border-color: #5b77b2;
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

.empty-pane-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.empty-pane-title {
  font-size: 12px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.empty-pane-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius, 6px);
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
}

.empty-pane-close-btn:active {
  transform: scale(0.95);
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

.empty-pane-action-btn {
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
  flex: 1;
  min-width: 0;
}

.empty-pane-action-btn:active {
  transform: scale(0.98);
}

.empty-pane-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (hover: hover) and (pointer: fine) {
  .empty-pane-row:hover {
    border-color: var(--accent);
  }

  .empty-pane-action-btn:hover,
  .empty-pane-close-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }
}
</style>
