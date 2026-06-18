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
            @pointerdown.prevent="onDragStart($event, idx)"
          >
            <span class="mdi mdi-drag-vertical"></span>
          </span>
          <span class="split-tab-input-wrap">
            <input
              v-if="!isSplitMode"
              type="radio"
              class="split-tab-input"
              :checked="tab.id === activeTabId"
              @click.stop="onRadioClick(tab)"
            />
            <input
              v-else
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
          </span>
          <button
            type="button"
            class="split-tab-icon-btn"
            :title="tab.hidden ? 'Show in tab bar' : 'Hide from tab bar'"
            @click.stop="toggleHidden(tab)"
          >
            <span class="mdi" :class="tab.hidden ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"></span>
          </button>
          <button type="button" class="split-tab-close-btn" @click.stop="onClose(tab)">&times;</button>
        </div>
        <div v-if="openTabs.length === 0" class="clone-repo-empty">No open tabs</div>
      </div>

      <template v-if="orphanSessions.length">
        <div class="orphan-head">
          <span class="orphan-title">Orphan sessions</span>
          <span class="orphan-desc">tmux sessions with no open tab</span>
        </div>
        <div class="orphan-list">
          <div v-for="s in orphanSessions" :key="s.session_id" class="orphan-row">
            <div class="orphan-meta">
              <span class="orphan-name">{{ s.workspace || s.session_id }}</span>
              <span class="orphan-sub">{{ s.session_id }}</span>
            </div>
            <button type="button" class="orphan-btn" @click="openOrphan(s)" title="Open as tab">
              <span class="mdi mdi-tab-plus"></span>
            </button>
            <button type="button" class="orphan-btn danger" @click="closeOrphan(s)" title="Close session">
              <span class="mdi mdi-close"></span>
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { inject, computed, ref, onMounted } from "vue";
import SplitModeSelector from "./SplitModeSelector.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useApi } from "../composables/useApi.js";
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

function toggleHidden(tab) {
  // タブバーから隠す / 戻す。tmux セッション自体には影響しない。
  // store 側で reactivity を発火させる必要がある（tab は markRaw されている）。
  terminalStore.setTabHidden(tab.id, !tab.hidden);
}

const { dragFromIdx, dragOverIdx, onDragStart } = useListDragSort({
  rowSelector: ".split-tab-row",
  onReorder: (fromIdx, toIdx) => terminalStore.moveTab(fromIdx, toIdx),
});

const { apiGet, apiDelete } = useApi();
const orphanSessions = ref([]);

async function loadOrphans() {
  const { ok, data } = await apiGet("/terminal/sessions");
  if (!ok || !Array.isArray(data)) {
    orphanSessions.value = [];
    return;
  }
  const knownIds = new Set(openTabs.value.map((t) => t.sessionId).filter(Boolean));
  orphanSessions.value = data.filter((s) => !knownIds.has(s.session_id));
}

function openOrphan(s) {
  const tab = terminalStore.addTerminalTab({
    wsUrl: `/terminal/ws/${s.session_id}`,
    workspace: s.workspace || null,
    wsIcon: s.icon ? s.icon : null,
    wsIconColor: s.icon_color || null,
    icon: s.job_name ? (s.icon || "mdi-play") : "mdi-console",
    iconColor: s.icon_color || null,
    jobName: s.job_name || null,
    jobLabel: s.job_label || (s.workspace || s.session_id),
    restored: false,
    hidden: false,
  });
  emit("tab:select", { tab });
  loadOrphans();
}

async function closeOrphan(s) {
  const label = s.workspace || s.session_id;
  if (!await confirm(`Close session "${label}"? The tmux session will be killed.`)) return;
  await apiDelete(`/terminal/sessions/${encodeURIComponent(s.session_id)}`, { errorMessage: "Failed to close session" });
  await loadOrphans();
}

onMounted(loadOrphans);
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
  width: 28px;
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

.split-tab-close-btn,
.split-tab-icon-btn {
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
  cursor: pointer;
}
.split-tab-icon-btn:hover {
  color: var(--text-primary);
}

.orphan-head {
  margin-top: 16px;
  padding: 8px 4px 6px;
  border-top: 2px solid var(--accent);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.orphan-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.orphan-desc {
  font-size: 11px;
  color: var(--text-muted);
}
.orphan-list {
  display: flex;
  flex-direction: column;
}
.orphan-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}
.orphan-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.orphan-name {
  font-size: 14px;
  color: var(--text-primary);
}
.orphan-sub {
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.orphan-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
}
.orphan-btn.danger:hover {
  background: color-mix(in srgb, var(--error) 20%, var(--bg-tertiary));
  color: var(--error);
}
</style>
