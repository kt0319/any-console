<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <div class="detached-head">
        <span class="detached-title">Tab layout</span>
        <span class="detached-desc">split mode and arrangement</span>
      </div>
      <SplitModeSelector
        :current-mode="currentMode"
        :tab-count="openTabs.length"
        @select="setMode"
      />

      <div class="detached-head">
        <span class="detached-title">Attached tabs</span>
        <span class="detached-desc">open tabs in the tab bar</span>
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
            title="Detach (keep session running without a tab)"
            @click.stop="onDetach(tab)"
          >
            <span class="mdi mdi-link-variant-off"></span>
          </button>
          <button type="button" class="split-tab-close-btn" @click.stop="onClose(tab)">&times;</button>
        </div>
        <div v-if="openTabs.length === 0" class="clone-repo-empty">No open tabs</div>
      </div>

      <div class="detached-head">
        <span class="detached-title">Detached tabs</span>
        <span class="detached-desc">sessions running without an open tab</span>
      </div>
      <div v-if="!detachedSessions.length" class="detached-empty">No detached sessions</div>
      <div v-else class="detached-list">
        <div v-for="s in detachedSessions" :key="s.tmux_name" class="detached-row" :data-session-id="s.session_id || null">
          <div class="detached-meta">
            <span class="detached-name">
              {{ s.workspace || s.job_label || s.job_name || (s.external ? s.tmux_name : "terminal") }}
              <span v-if="s.external" class="detached-tag">external</span>
            </span>
            <span v-if="s.external" class="detached-sub">{{ s.tmux_name }}</span>
          </div>
          <button v-if="!s.external" type="button" class="detached-btn" @click="openDetached(s)" title="Open as tab">
            <span class="mdi mdi-tab-plus"></span>
          </button>
          <button v-else type="button" class="detached-btn" @click="adoptDetached(s)" title="Adopt into any-console (rename tmux session)">
            <span class="mdi mdi-import"></span>
          </button>
          <button type="button" class="detached-btn danger" @click="closeDetached(s)" title="Close session">
            <span class="mdi mdi-close"></span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { inject, computed, ref, onMounted } from "vue";
import SplitModeSelector from "./SplitModeSelector.vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useLayoutStore } from "../stores/layout.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { renderIconStr } from "../utils/render-icon.js";
import { buildSessionTabParams } from "../utils/session-jobs.js";
import { emit } from "../app-bridge.js";
import { useConfirm } from "../composables/useConfirm.js";
import { useApi } from "../composables/useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { useTerminal } from "../composables/useTerminal.js";
import { useListDragSort } from "../composables/useListDragSort.js";
import { buildDetachedSessionList } from "../utils/detached-sessions.js";
import {
  EP_TERMINAL_SESSIONS,
  EP_SYSTEM_TMUX_INFO,
  EP_SYSTEM_TMUX_ADOPT,
  EP_SYSTEM_TMUX_KILL,
  EP_JOBS_WORKSPACES,
  terminalSessionPath,
  terminalWsPath,
  terminalSessionDetachedPath,
} from "../utils/endpoints.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "Tabs & Sessions";

const terminalStore = useTerminalStore();
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const { confirm } = useConfirm();
const { disconnectTerminal } = useTerminal();

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

function onDetach(tab) {
  disconnectTerminal(tab);
  terminalStore.detachTab(tab.id);
  loadDetached();
}

const { dragFromIdx, dragOverIdx, onDragStart } = useListDragSort({
  rowSelector: ".split-tab-row",
  onReorder: (fromIdx, toIdx) => terminalStore.moveTab(fromIdx, toIdx),
});

const { apiGet, apiDelete, apiPost, apiPut } = useApi();
const detachedSessions = ref([]);
const allJobsData = ref({});

async function loadDetached() {
  // 全 tmux セッション + any-console 管理セッションをマージ。
  // - ac- 付き = any-console 管理（Open 可能）
  // - ac- なし = ユーザ個人セッション（external 扱い、Close のみ）
  const [tmuxRes, ownedRes, jobsRes] = await Promise.all([
    getWithRetry(apiGet, EP_SYSTEM_TMUX_INFO),
    getWithRetry(apiGet, EP_TERMINAL_SESSIONS),
    getWithRetry(apiGet, EP_JOBS_WORKSPACES),
  ]);
  allJobsData.value = jobsRes.ok && jobsRes.data ? jobsRes.data : {};
  const owned = ownedRes.ok && Array.isArray(ownedRes.data) ? ownedRes.data : [];
  const knownTabIds = new Set(openTabs.value.map((t) => t.sessionId).filter(Boolean));
  const all = tmuxRes.ok && Array.isArray(tmuxRes.data?.sessions) ? tmuxRes.data.sessions : [];
  const prefix = tmuxRes.ok && tmuxRes.data?.prefix ? tmuxRes.data.prefix : undefined;
  detachedSessions.value = buildDetachedSessionList(all, owned, knownTabIds, prefix);
}

function openDetached(s) {
  const tab = terminalStore.addTerminalTab({
    ...buildSessionTabParams(s, { workspaces: workspaceStore.allWorkspaces, allJobs: allJobsData.value }),
    wsUrl: terminalWsPath(s.session_id),
    jobLabel: s.job_label || (s.workspace || s.session_id),
    restored: false,
  });
  apiPut(terminalSessionDetachedPath(s.session_id), { detached: false }).catch(() => {});
  emit("tab:select", { tab });
  loadDetached();
}

async function adoptDetached(s) {
  // 外部 tmux セッションを ac- プレフィックスにリネームして any-console 管理化、
  // そのままタブとして開く。
  if (!await confirm(`Adopt "${s.tmux_name}" into any-console? The tmux session will be renamed.`)) return;
  const { ok, data } = await apiPost(EP_SYSTEM_TMUX_ADOPT, { name: s.tmux_name }, { errorMessage: "Failed to adopt session" });
  if (!ok || !data?.session_id) return;
  const tab = terminalStore.addTerminalTab({
    wsUrl: terminalWsPath(data.session_id),
    workspace: null,
    wsIcon: null,
    wsIconColor: null,
    icon: "mdi-console",
    iconColor: null,
    jobName: null,
    jobLabel: s.tmux_name,
    restored: false,
  });
  emit("tab:select", { tab });
  await loadDetached();
}

async function closeDetached(s) {
  const label = s.workspace || s.session_id || s.tmux_name;
  if (!await confirm(`Close session "${label}"? The tmux session will be killed.`)) return;
  if (s.session_id) {
    // any-console 管理セッションは /terminal/sessions API で kill
    await apiDelete(terminalSessionPath(s.session_id), { errorMessage: "Failed to close session" });
  } else {
    // 外部セッション。/system/tmux/kill 経由
    await apiPost(EP_SYSTEM_TMUX_KILL, { name: s.tmux_name }, { errorMessage: "Failed to kill session" });
  }
  await loadDetached();
}

onMounted(loadDetached);
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
@media (hover: hover) and (pointer: fine) {
  .split-tab-icon-btn:hover {
    color: var(--text-primary);
  }
}

.detached-head {
  margin-top: 12px;
  padding: 6px 4px 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.detached-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.detached-desc {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.7;
}
.detached-list {
  display: flex;
  flex-direction: column;
}
.detached-empty {
  padding: 10px 4px;
  font-size: 12px;
  color: var(--text-muted);
}
.detached-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}
.detached-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.detached-name {
  font-size: 14px;
  color: var(--text-primary);
}
.detached-sub {
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detached-btn {
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
.detached-tag {
  margin-left: 6px;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
}
.detached-btn.danger:hover {
  background: color-mix(in srgb, var(--error) 20%, var(--bg-tertiary));
  color: var(--error);
}
</style>
