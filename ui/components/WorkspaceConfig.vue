<template>
  <div class="modal-scroll-body">
    <!-- ワークスペース一覧 -->
    <div v-if="!editWs" ref="wsListEl" class="ws-config-list">
      <div
        v-for="(ws, idx) in allWorkspaces"
        :key="ws.name"
        class="ws-check-item"
        :class="{ dragging: dragIdx === idx }"
        :style="dragIdx === idx ? { transform: `translateY(${dragOffsetY}px)` } : {}"
      >
        <span
          class="ws-check-drag-handle"
          @mousedown.prevent="onDragStart($event, idx)"
          @touchstart.prevent="onDragStart($event, idx)"
        ><span class="mdi mdi-drag"></span></span>
        <label class="ws-check-row">
          <input type="checkbox" :checked="!ws.hidden" @change="toggleVisibility(ws, $event.target.checked)" />
          <span class="ws-icon-display" v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
          <span class="ws-check-label">{{ ws.name }}</span>
        </label>
        <span v-if="wsJobCounts[ws.name]" class="ws-job-count">{{ wsJobCounts[ws.name] }}</span>
        <button type="button" class="picker-ws-icon-btn ws-gear-btn" @click="openWsSettings(ws)">
          <span class="mdi mdi-cog"></span>
        </button>
      </div>
      <div v-if="allWorkspaces.length === 0" class="clone-repo-empty">ワークスペースがありません</div>
    </div>

    <!-- ワークスペース個別設定 -->
    <div v-if="editWs" class="ws-settings-detail">
      <div class="ws-settings-row">
        <span class="ws-settings-label">アイコン</span>
        <button type="button" class="icon-select-btn" @click="openIconPicker">
          <span class="icon-select-preview">
            <span v-html="renderIconStr(editIcon || 'mdi-console', editIconColor, 18)"></span>
            <span class="icon-select-label">{{ editIcon || 'デフォルト' }}</span>
          </span>
        </button>
      </div>

      <!-- ジョブ一覧 -->
      <div class="ws-settings-section">
        <div class="ws-settings-section-header">
          <span>ジョブ</span>
          <button type="button" class="ws-add-item-btn" @click="startAddJob">
            <span class="mdi mdi-plus"></span>
          </button>
        </div>
        <div class="ws-settings-item-list">
          <div v-if="loadingJobs" class="ws-settings-empty">読み込み中...</div>
          <div v-else-if="jobEntries.length === 0" class="ws-settings-empty">ジョブなし</div>
          <div
            v-for="entry in jobEntries"
            :key="entry.name"
            class="ws-settings-item"
            @click="startEditJob(entry)"
          >
            <span class="ws-settings-item-icon" v-html="renderIconStr(entry.job.icon || 'mdi-play', entry.job.icon_color, 16)"></span>
            <span class="ws-settings-item-name">{{ entry.job.label || entry.name }}</span>
            <div class="ws-settings-item-actions">
              <button type="button" class="ws-settings-item-action-btn" title="削除" @click.stop="deleteJob(entry)">
                <span class="mdi mdi-delete-outline"></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="ws-settings-section ws-delete-section">
        <button type="button" class="ws-delete-config-btn" @click="deleteWsConfig">
          <span class="mdi mdi-delete-outline"></span>
          ワークスペースを削除
        </button>
      </div>

      <div v-if="saveError" class="clone-repo-error">{{ saveError }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, watchEffect, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useAuthStore } from "../stores/auth.js";
import { renderIconStr } from "../utils/render-icon.js";

const modalTitle = inject("modalTitle");
const pushView = inject("pushView");
const viewState = inject("viewState");
modalTitle.value = "ワークスペース設定";

const workspaceStore = useWorkspaceStore();
const auth = useAuthStore();

const wsListEl = ref(null);
const allWorkspaces = ref([]);
const editWs = ref(null);
watchEffect(() => {
  modalTitle.value = editWs.value ? editWs.value.name : "ワークスペース設定";
});
const editIcon = ref("");
const editIconColor = ref("");
const saveError = ref("");

const jobEntries = ref([]);
const loadingJobs = ref(false);
const wsJobCounts = ref({});

async function loadWorkspaceConfig() {
  await workspaceStore.fetchStatuses(auth);
  allWorkspaces.value = workspaceStore.allWorkspaces || [];
  fetchAllJobCounts();
}

async function fetchAllJobCounts() {
  try {
    const res = await auth.apiFetch("/jobs/workspaces");
    if (!res || !res.ok) return;
    const data = await res.json();
    const counts = {};
    for (const [name, jobs] of Object.entries(data)) {
      counts[name] = Object.keys(jobs).filter((k) => k !== "terminal").length;
    }
    wsJobCounts.value = counts;
  } catch { /* ignore */ }
}

async function toggleVisibility(ws, checked) {
  try {
    await auth.apiFetch(`/workspaces/${encodeURIComponent(ws.name)}/config`, {
      method: "PUT",
      body: { icon: ws.icon || "", icon_color: ws.icon_color || "", hidden: !checked },
    });
    ws.hidden = !checked;
  } catch { /* ignore */ }
}

function openWsSettings(ws) {
  editWs.value = ws;
  editIcon.value = ws.icon || "";
  editIconColor.value = ws.icon_color || "";
  saveError.value = "";
  loadWorkspaceJobs();
}

function goBackToList() {
  editWs.value = null;
  jobEntries.value = [];
}

function handleBack() {
  if (editWs.value) {
    goBackToList();
    return true;
  }
  return false;
}

async function loadWorkspaceJobs() {
  if (!editWs.value) return;
  loadingJobs.value = true;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(editWs.value.name)}/jobs`);
    if (res && res.ok) {
      const data = await res.json();
      jobEntries.value = Object.entries(data)
        .filter(([name]) => name !== "terminal")
        .map(([name, job]) => ({ name, job }));
    }
  } catch { /* ignore */ }
  finally { loadingJobs.value = false; }
}

function startAddJob() {
  pushView("JobConfig", {
    workspaceName: editWs.value.name,
    jobEntry: null,
    onReturn: () => { loadWorkspaceJobs(); },
  });
}

function startEditJob(entry) {
  pushView("JobConfig", {
    workspaceName: editWs.value.name,
    jobEntry: entry,
    onReturn: () => { loadWorkspaceJobs(); },
  });
}

async function deleteJob(entry) {
  if (!editWs.value) return;
  try {
    await auth.apiFetch(`/workspaces/${encodeURIComponent(editWs.value.name)}/jobs/${encodeURIComponent(entry.name)}`, {
      method: "DELETE",
    });
    await loadWorkspaceJobs();
  } catch { /* ignore */ }
}

async function deleteWsConfig() {
  if (!editWs.value) return;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(editWs.value.name)}/config`, {
      method: "DELETE",
    });
    if (res.ok) {
      goBackToList();
      await loadWorkspaceConfig();
    }
  } catch { /* ignore */ }
}

async function saveWsConfig() {
  if (!editWs.value) return;
  saveError.value = "";
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(editWs.value.name)}/config`, {
      method: "PUT",
      body: {
        icon: editIcon.value.trim(),
        icon_color: editIconColor.value.trim(),
        hidden: !!editWs.value.hidden,
      },
    });
    if (!res.ok) {
      const data = await res.json();
      saveError.value = data.detail || "保存に失敗しました";
    } else {
      editWs.value.icon = editIcon.value.trim();
      editWs.value.icon_color = editIconColor.value.trim();
    }
  } catch (e) {
    saveError.value = e.message || "エラーが発生しました";
  }
}

function openIconPicker() {
  pushView("IconPicker", {
    currentIcon: editIcon.value,
    currentColor: editIconColor.value,
    onReturn: (result, parentEntry) => {
      if (parentEntry) {
        parentEntry.state.initialWsName = editWs.value?.name;
        parentEntry.state.pendingIcon = result.icon;
        parentEntry.state.pendingColor = result.color;
      }
    },
  });
}

// ドラッグ並び替え
const dragIdx = ref(-1);
const dragOffsetY = ref(0);
let dragStartY = 0;
let dragRowHeight = 0;
let dragDidMove = false;

function onDragStart(e, idx) {
  if (allWorkspaces.value.length < 2) return;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const list = wsListEl.value;
  if (!list) return;
  const rows = list.querySelectorAll(".ws-check-item");
  dragRowHeight = rows[0]?.getBoundingClientRect().height || 40;
  dragStartY = clientY;
  dragIdx.value = idx;
  dragOffsetY.value = 0;
  dragDidMove = false;
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
  document.addEventListener("touchmove", onDragMove, { passive: false });
  document.addEventListener("touchend", onDragEnd);
  document.addEventListener("touchcancel", onDragEnd);
}

function onDragMove(e) {
  if (dragIdx.value < 0) return;
  if (e.cancelable) e.preventDefault();
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  const dy = clientY - dragStartY;
  dragOffsetY.value = dy;

  const steps = Math.round(dy / dragRowHeight);
  if (steps === 0) return;
  const newIdx = Math.max(0, Math.min(dragIdx.value + steps, allWorkspaces.value.length - 1));
  if (newIdx === dragIdx.value) return;

  const arr = allWorkspaces.value;
  const [moved] = arr.splice(dragIdx.value, 1);
  arr.splice(newIdx, 0, moved);
  dragIdx.value = newIdx;
  dragStartY = clientY;
  dragOffsetY.value = 0;
  dragDidMove = true;
}

function onDragEnd() {
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
  document.removeEventListener("touchmove", onDragMove);
  document.removeEventListener("touchend", onDragEnd);
  document.removeEventListener("touchcancel", onDragEnd);
  dragIdx.value = -1;
  dragOffsetY.value = 0;
  if (dragDidMove) {
    saveWorkspaceOrder();
  }
}

async function saveWorkspaceOrder() {
  const order = allWorkspaces.value.map((ws) => ws.name);
  try {
    await auth.apiFetch("/workspace-order", {
      method: "PUT",
      body: { order },
    });
  } catch { /* ignore */ }
}

onBeforeUnmount(() => {
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
  document.removeEventListener("touchmove", onDragMove);
  document.removeEventListener("touchend", onDragEnd);
  document.removeEventListener("touchcancel", onDragEnd);
});

defineExpose({ handleBack });

onMounted(async () => {
  await loadWorkspaceConfig();
  const initialWsName = viewState.value?.initialWsName;
  if (initialWsName) {
    const ws = allWorkspaces.value.find((w) => w.name === initialWsName);
    if (ws) openWsSettings(ws);
  }
  if ("pendingIcon" in (viewState.value || {})) {
    editIcon.value = viewState.value.pendingIcon;
    editIconColor.value = viewState.value.pendingColor ?? "";
    delete viewState.value.pendingIcon;
    delete viewState.value.pendingColor;
    saveWsConfig();
  }
});
</script>

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

.ws-check-item input[type="checkbox"] {
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
}

.ws-check-item input[type="checkbox"]:checked {
  border-color: var(--accent);
  background: var(--accent);
}

.ws-check-item input[type="checkbox"]:checked::after {
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
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
}

.picker-ws-icon-btn .mdi {
  font-size: 18px;
}

.ws-job-count {
  font-size: 11px;
  color: var(--text-muted);
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
  border-radius: 6px;
}

.ws-add-item-btn {
  min-width: auto;
  min-height: auto;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-muted);
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
}

.ws-settings-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border);
}

.ws-settings-label {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
  min-width: 48px;
}

.ws-settings-section {
  padding: 8px 0;
}

.ws-settings-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}

.ws-settings-item-list {
  padding: 0;
}

.ws-settings-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 8px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 13px;
  min-height: 40px;
}

.ws-settings-item.dragging {
  opacity: 0.72;
  background: var(--bg-tertiary);
}

.ws-settings-item:last-child {
  border-bottom: none;
}

.ws-settings-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ws-settings-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-settings-item-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.ws-settings-item-action-btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  min-height: 32px;
  padding: 0;
  border-radius: 8px;
  font-size: 16px;
  line-height: 1;
}

.ws-settings-empty {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.clone-repo-empty,
.clone-repo-error {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.clone-repo-error {
  color: var(--error);
}

.ws-check-drag-handle {
  flex-shrink: 0;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 20px;
  cursor: grab;
  touch-action: none;
}

.icon-select-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  min-height: 40px;
  font-size: 13px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.icon-select-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.icon-select-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

.icon-select-preview .mdi {
  font-size: 18px;
  vertical-align: middle;
}

.icon-select-preview :deep(.favicon-icon) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.ws-delete-section {
  margin-top: 8px;
  padding: 8px 0;
}

.ws-delete-config-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px;
  font-size: 13px;
  color: var(--error);
  background: transparent;
  border: 1px solid var(--error);
  border-radius: var(--radius);
  cursor: pointer;
}
</style>
