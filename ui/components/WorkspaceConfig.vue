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
          <span class="ws-icon-display" v-html="renderIcon(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
          <span class="ws-check-label">{{ ws.name }}</span>
        </label>
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
        <button type="button" class="icon-select-btn" @click="showIconPicker = !showIconPicker">
          <span class="icon-select-preview">
            <span v-html="renderIcon(editIcon || 'mdi-console', editIconColor, 18)"></span>
            <span class="icon-select-label">{{ editIcon || 'デフォルト' }}</span>
          </span>
        </button>
      </div>

      <!-- インラインアイコンピッカー -->
      <div v-if="showIconPicker" class="icon-picker-inline">
        <div class="icon-picker-input-row">
          <input
            type="text"
            class="form-input icon-picker-search"
            v-model="iconSearch"
            placeholder="アイコン検索"
            autocomplete="off"
            @input="filterIcons"
          />
        </div>
        <div class="color-palette">
          <button
            v-for="c in PRESET_COLORS"
            :key="c.value"
            type="button"
            class="color-palette-item"
            :class="{ selected: editIconColor === c.value }"
            :title="c.label"
            :style="{ background: c.value || 'var(--text-primary)' }"
            @click="editIconColor = c.value"
          ></button>
        </div>
        <div class="icon-picker-grid">
          <div v-if="loadingIcons" class="icon-picker-loading">読み込み中...</div>
          <button
            v-for="icon in filteredIcons"
            :key="icon.name"
            type="button"
            class="icon-picker-item"
            :class="{ selected: editIcon === 'mdi-' + icon.name }"
            :title="icon.name"
            @click="selectIcon(icon.name)"
          >
            <span :class="'mdi mdi-' + icon.name"></span>
          </button>
        </div>
        <div class="icon-picker-actions">
          <button type="button" @click="clearIcon">クリア</button>
          <button type="button" class="primary" @click="confirmIcon">決定</button>
        </div>
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
            <span class="ws-settings-item-icon" v-html="renderIcon(entry.job.icon || 'mdi-play', entry.job.icon_color, 16)"></span>
            <span class="ws-settings-item-name">{{ entry.job.label || entry.name }}</span>
            <div class="ws-settings-item-actions">
              <button type="button" class="ws-settings-item-action-btn" title="削除" @click.stop="deleteJob(entry)">
                <span class="mdi mdi-delete-outline"></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ジョブ追加/編集フォーム -->
      <div v-if="jobForm" class="ws-settings-section">
        <div class="settings-section-label">{{ jobForm.isNew ? 'ジョブ追加' : 'ジョブ編集' }}</div>
        <div class="ws-settings-row">
          <span class="ws-settings-label">名前</span>
          <input type="text" class="form-input" v-model="jobForm.name" :disabled="!jobForm.isNew" placeholder="ジョブ名" autocomplete="off" />
        </div>
        <div class="ws-settings-row">
          <span class="ws-settings-label">ラベル</span>
          <input type="text" class="form-input" v-model="jobForm.label" placeholder="表示名" autocomplete="off" />
        </div>
        <div class="ws-settings-row">
          <span class="ws-settings-label">コマンド</span>
          <input type="text" class="form-input" v-model="jobForm.command" placeholder="実行コマンド" autocomplete="off" />
        </div>
        <div class="ws-settings-row">
          <span class="ws-settings-label">アイコン</span>
          <input type="text" class="form-input" v-model="jobForm.icon" placeholder="mdi-play" autocomplete="off" />
        </div>
        <div class="ws-settings-row">
          <span class="ws-settings-label">アイコン色</span>
          <input type="text" class="form-input" v-model="jobForm.icon_color" placeholder="#ffffff" autocomplete="off" />
        </div>
        <div class="ws-settings-row" style="gap:8px">
          <label class="form-check-label"><input type="checkbox" v-model="jobForm.confirm" /> 確認ダイアログ</label>
          <label class="form-check-label"><input type="checkbox" v-model="jobForm.terminal" /> ターミナルで実行</label>
        </div>
        <div class="ws-settings-row" style="gap:8px">
          <button type="button" @click="jobForm = null">キャンセル</button>
          <button type="button" class="primary" :disabled="savingJob" @click="saveJob">
            {{ savingJob ? '保存中...' : '保存' }}
          </button>
        </div>
        <div v-if="jobFormError" class="clone-repo-error">{{ jobFormError }}</div>
      </div>

      <div class="ws-settings-row" style="margin-top:12px">
        <button type="button" class="primary" :disabled="saving" @click="saveWsConfig">
          {{ saving ? '保存中...' : 'アイコン保存' }}
        </button>
      </div>
      <div v-if="saveError" class="clone-repo-error">{{ saveError }}</div>
      <div v-if="saveSuccess" style="color:var(--success);padding:8px;text-align:center">{{ saveSuccess }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, watch, watchEffect, onMounted, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useAuthStore } from "../stores/auth.js";
import { renderIconStr } from "../utils/render-icon.js";

const modalTitle = inject("modalTitle");
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
const saving = ref(false);
const saveError = ref("");
const saveSuccess = ref("");
const showIconPicker = ref(false);

const jobEntries = ref([]);
const loadingJobs = ref(false);
const jobForm = ref(null);
const savingJob = ref(false);
const jobFormError = ref("");

const iconSearch = ref("");
const iconMeta = ref([]);
const filteredIcons = ref([]);
const loadingIcons = ref(false);

const PRESET_COLORS = [
  { label: "デフォルト", value: "" },
  { label: "赤", value: "#e53935" },
  { label: "ピンク", value: "#d81b60" },
  { label: "紫", value: "#8e24aa" },
  { label: "青", value: "#1e88e5" },
  { label: "水色", value: "#00acc1" },
  { label: "緑", value: "#43a047" },
  { label: "黄", value: "#fdd835" },
  { label: "オレンジ", value: "#fb8c00" },
  { label: "グレー", value: "#757575" },
  { label: "白", value: "#ffffff" },
];

function renderIcon(icon, color, size) {
  return renderIconStr(icon, color, size);
}

async function load() {
  await workspaceStore.fetchStatuses(auth);
  allWorkspaces.value = workspaceStore.allWorkspaces || [];
}

async function toggleVisibility(ws, checked) {
  try {
    await auth.apiFetch(`/workspaces/${encodeURIComponent(ws.name)}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icon: ws.icon || "", icon_color: ws.icon_color || "", hidden: !checked }),
    });
    ws.hidden = !checked;
  } catch { /* ignore */ }
}

function openWsSettings(ws) {
  editWs.value = ws;
  editIcon.value = ws.icon || "";
  editIconColor.value = ws.icon_color || "";
  saveError.value = "";
  saveSuccess.value = "";
  showIconPicker.value = false;
  jobForm.value = null;
  loadJobs();
}

function goBackToList() {
  editWs.value = null;
  jobEntries.value = [];
  jobForm.value = null;
  showIconPicker.value = false;
}

async function loadJobs() {
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
  jobForm.value = { isNew: true, name: "", label: "", command: "", icon: "", icon_color: "", confirm: true, terminal: true };
  jobFormError.value = "";
}

function startEditJob(entry) {
  jobForm.value = {
    isNew: false,
    name: entry.name,
    label: entry.job.label || "",
    command: entry.job.command || "",
    icon: entry.job.icon || "",
    icon_color: entry.job.icon_color || "",
    confirm: entry.job.confirm !== false,
    terminal: entry.job.terminal !== false,
  };
  jobFormError.value = "";
}

async function saveJob() {
  if (!editWs.value || !jobForm.value) return;
  const f = jobForm.value;
  if (!f.name.trim()) { jobFormError.value = "名前を入力してください"; return; }
  if (!f.command.trim()) { jobFormError.value = "コマンドを入力してください"; return; }
  savingJob.value = true;
  jobFormError.value = "";
  try {
    const method = f.isNew ? "POST" : "PUT";
    const url = f.isNew
      ? `/workspaces/${encodeURIComponent(editWs.value.name)}/jobs`
      : `/workspaces/${encodeURIComponent(editWs.value.name)}/jobs/${encodeURIComponent(f.name)}`;
    const res = await auth.apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: f.label.trim(),
        command: f.command.trim(),
        icon: f.icon.trim(),
        icon_color: f.icon_color.trim(),
        confirm: f.confirm,
        terminal: f.terminal,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      jobFormError.value = data.detail || "保存に失敗しました";
    } else {
      jobForm.value = null;
      await loadJobs();
    }
  } catch (e) {
    jobFormError.value = e.message || "エラーが発生しました";
  } finally {
    savingJob.value = false;
  }
}

async function deleteJob(entry) {
  if (!editWs.value) return;
  try {
    await auth.apiFetch(`/workspaces/${encodeURIComponent(editWs.value.name)}/jobs/${encodeURIComponent(entry.name)}`, {
      method: "DELETE",
    });
    await loadJobs();
  } catch { /* ignore */ }
}

async function saveWsConfig() {
  if (!editWs.value) return;
  saving.value = true;
  saveError.value = "";
  saveSuccess.value = "";
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(editWs.value.name)}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        icon: editIcon.value.trim(),
        icon_color: editIconColor.value.trim(),
        hidden: !!editWs.value.hidden,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      saveError.value = data.detail || "保存に失敗しました";
    } else {
      editWs.value.icon = editIcon.value.trim();
      editWs.value.icon_color = editIconColor.value.trim();
      saveSuccess.value = "保存しました";
    }
  } catch (e) {
    saveError.value = e.message || "エラーが発生しました";
  } finally {
    saving.value = false;
  }
}

// アイコンピッカー
async function loadIconMeta() {
  if (iconMeta.value.length > 0) return;
  loadingIcons.value = true;
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/@mdi/svg@7/meta.json");
    iconMeta.value = await res.json();
    filterIcons();
  } catch { /* ignore */ }
  finally { loadingIcons.value = false; }
}

function filterIcons() {
  const q = iconSearch.value.toLowerCase().trim();
  if (!q) {
    filteredIcons.value = iconMeta.value.slice(0, 200);
    return;
  }
  filteredIcons.value = iconMeta.value
    .filter((i) => i.name.includes(q) || (i.aliases && i.aliases.some((a) => a.includes(q))) || (i.tags && i.tags.some((t) => t.includes(q))))
    .slice(0, 200);
}

function selectIcon(name) {
  editIcon.value = "mdi-" + name;
}

function clearIcon() {
  editIcon.value = "";
  editIconColor.value = "";
}

function confirmIcon() {
  showIconPicker.value = false;
}

watch(showIconPicker, (v) => { if (v) loadIconMeta(); });

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
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

defineExpose({ load, goBackToList, editWs });

onMounted(load);
</script>
