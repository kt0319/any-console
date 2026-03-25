<template>
  <div class="modal-scroll-body">
    <div class="ws-settings-section">
      <div class="ws-settings-section-header">
        <span>共通ジョブ</span>
        <button type="button" class="ws-add-item-btn" @click="startAddJob">
          <span class="mdi mdi-plus"></span>
        </button>
      </div>
      <div class="ws-settings-item-list">
        <div v-if="isLoading" class="ws-settings-empty">読み込み中...</div>
        <div v-else-if="jobEntries.length === 0" class="ws-settings-empty">共通ジョブなし</div>
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
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../composables/useApi.js";
import { useModalView } from "../composables/useModalView.js";
import { renderIconStr } from "../utils/render-icon.js";

const { modalTitle, pushView } = useModalView();
modalTitle.value = "共通ジョブ設定";

const { apiGet, apiDelete } = useApi();

const jobEntries = ref([]);
const isLoading = ref(false);

async function loadGlobalJobs() {
  isLoading.value = true;
  try {
    const { ok, data } = await apiGet("/global/jobs");
    if (ok) {
      jobEntries.value = Object.entries(data)
        .map(([name, job]) => ({ name, job }));
    }
  } catch { /* ignore */ }
  finally { isLoading.value = false; }
}

function startAddJob() {
  pushView("JobConfig", {
    isGlobal: true,
    workspaceName: null,
    jobEntry: null,
    onReturn: () => { loadGlobalJobs(); },
  });
}

function startEditJob(entry) {
  pushView("JobConfig", {
    isGlobal: true,
    workspaceName: null,
    jobEntry: entry,
    onReturn: () => { loadGlobalJobs(); },
  });
}

async function deleteJob(entry) {
  try {
    await apiDelete(`/global/jobs/${encodeURIComponent(entry.name)}`);
    await loadGlobalJobs();
  } catch { /* ignore */ }
}

onMounted(() => {
  loadGlobalJobs();
});
</script>

<style scoped>
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
  border-radius: var(--radius);
  font-size: 16px;
  line-height: 1;
}

.ws-settings-empty {
  padding: 12px 8px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
