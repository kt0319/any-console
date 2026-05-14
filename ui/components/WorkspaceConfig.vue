<template>
  <div class="modal-scroll-body">
    <template v-if="!editWs">
      <WorkspaceAddInline @added="loadWorkspaceConfig" />
      <div ref="wsListEl" class="ws-config-list">
        <div
          v-for="(ws, idx) in allWorkspaces"
          :key="ws.name"
          class="ws-check-item"
          :class="{ dragging: dragIdx === idx }"
          :style="dragIdx === idx ? { transform: `translateY(${dragOffsetY}px)` } : {}"
        >
          <span
            class="drag-handle"
            @mousedown.prevent="onDragStart($event, idx)"
            @touchstart.prevent="onDragStart($event, idx)"
          ><span class="mdi mdi-drag"></span></span>
          <label class="ws-check-row">
            <input type="checkbox" class="form-checkbox" :checked="!ws.hidden" @change="toggleVisibility(ws, $event.target.checked)" />
            <span class="ws-icon-display" v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
            <span class="ws-check-label">{{ ws.name }}</span>
          </label>
          <span v-if="wsJobCounts[ws.name]" class="ws-job-count-badge">{{ wsJobCounts[ws.name] }}</span>
          <button type="button" class="picker-ws-icon-btn ws-gear-btn" @click="openWsSettings(ws)">
            <span class="mdi mdi-cog"></span>
          </button>
        </div>
        <div v-if="allWorkspaces.length === 0" class="clone-repo-empty">No workspaces</div>
      </div>
    </template>

    <WorkspaceEditPane
      v-if="editWs"
      :workspace="editWs"
      :pushView="pushView"
      :viewState="viewState"
      @deleted="onWorkspaceDeleted"
      @updated="onWorkspaceUpdated"
    />
  </div>
</template>

<script setup>
import { ref, watchEffect, onMounted, onBeforeUnmount } from "vue";
import WorkspaceAddInline from "./WorkspaceAddInline.vue";
import WorkspaceEditPane from "./WorkspaceEditPane.vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { useWorkspaceDrag } from "../composables/useWorkspaceDrag.js";
import { renderIconStr } from "../utils/render-icon.js";
import { EP_JOBS_WORKSPACES, EP_WORKSPACE_ORDER } from "../utils/endpoints.js";

const { modalTitle, pushView, viewState } = useModalView();
modalTitle.value = "Workspace Settings";

const workspaceStore = useWorkspaceStore();
const { apiGet, apiPut, wsEndpoint } = useApi();

const wsListEl = ref(null);
const allWorkspaces = ref([]);
const editWs = ref(null);
watchEffect(() => {
  modalTitle.value = editWs.value ? editWs.value.name : "Workspace Settings";
});

const wsJobCounts = ref({});

const { dragIdx, dragOffsetY, onDragStart, cleanup: cleanupDrag } = useWorkspaceDrag({
  items: allWorkspaces,
  listEl: wsListEl,
  onReorder: () => saveWorkspaceOrder(),
});

async function loadWorkspaceConfig() {
  await workspaceStore.fetchWorkspaces();
  allWorkspaces.value = workspaceStore.allWorkspaces || [];
  loadAllJobCounts();
}

async function loadAllJobCounts() {
  try {
    const { ok, data } = await apiGet(EP_JOBS_WORKSPACES);
    if (!ok) return;
    const counts = {};
    for (const [name, jobs] of Object.entries(data)) {
      counts[name] = Object.entries(jobs).filter(([k, j]) => k !== "terminal" && !j.common).length;
    }
    wsJobCounts.value = counts;
  } catch { /* ignore */ }
}

async function toggleVisibility(ws, checked) {
  try {
    const { ok } = await apiPut(wsEndpoint(ws.name, "config"), { icon: ws.icon || "", icon_color: ws.icon_color || "", hidden: !checked }, { errorMessage: "Failed to update workspace" });
    if (ok) ws.hidden = !checked;
  } catch { /* ignore */ }
}

function openWsSettings(ws) {
  editWs.value = ws;
}

function goBackToList() {
  editWs.value = null;
}

function handleBack() {
  if (editWs.value) {
    goBackToList();
    return true;
  }
  return false;
}

async function onWorkspaceDeleted() {
  goBackToList();
  await loadWorkspaceConfig();
}

function onWorkspaceUpdated() {
  workspaceStore.fetchWorkspaces();
}

async function saveWorkspaceOrder() {
  const order = allWorkspaces.value.map((ws) => ws.name);
  try {
    await apiPut(EP_WORKSPACE_ORDER, { order }, { errorMessage: "Failed to save workspace order" });
  } catch { /* ignore */ }
}

onBeforeUnmount(() => {
  cleanupDrag();
});

defineExpose({ handleBack });

onMounted(async () => {
  await loadWorkspaceConfig();
  const initialWsName = viewState.value?.initialWsName;
  if (initialWsName) {
    const ws = allWorkspaces.value.find((w) => w.name === initialWsName);
    if (ws) openWsSettings(ws);
  }
});
</script>

<style>
@import "../styles/settings-list.css";
</style>

<style scoped>
.ws-check-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 14px;
  min-height: 44px;
}

.ws-check-item:last-child {
  border-bottom: none;
}

.ws-check-item.dragging {
  opacity: 0.72;
  background: var(--bg-tertiary);
}

.ws-check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.ws-check-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-icon-display {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  font-size: 18px;
}

.picker-ws-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}

.picker-ws-icon-btn .mdi {
  font-size: 18px;
}

.ws-job-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-radius: 10px;
  flex-shrink: 0;
}

.ws-gear-btn {
  width: 30px;
  height: 30px;
  min-width: 30px;
  min-height: 30px;
  padding: 0;
  font-size: 15px;
  flex-shrink: 0;
  line-height: 1;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
</style>
