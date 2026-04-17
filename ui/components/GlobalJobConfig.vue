<template>
  <div class="modal-scroll-body">
    <div class="ws-settings-section">
      <div class="ws-settings-section-header">
        <span>Global Jobs</span>
        <button type="button" class="ws-add-item-btn" @click="startAddJob">
          <span class="mdi mdi-plus"></span>
        </button>
      </div>
      <div class="ws-settings-item-list">
        <div v-if="isLoading" class="ws-settings-empty">Loading...</div>
        <div v-else-if="jobEntries.length === 0" class="ws-settings-empty">No global jobs</div>
        <div
          v-for="entry in jobEntries"
          :key="entry.name"
          class="ws-settings-item"
          @click="startEditJob(entry)"
        >
          <span class="ws-settings-item-icon" v-html="renderIconStr(entry.job.icon || 'mdi-play', entry.job.icon_color, 16)"></span>
          <span class="ws-settings-item-name">{{ entry.job.label || entry.name }}</span>
          <div class="ws-settings-item-actions">
            <button type="button" class="ws-settings-item-action-btn" title="Delete" @click.stop="deleteJob(entry)">
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
import { emit } from "../app-bridge.js";
import { EP_GLOBAL_JOBS } from "../utils/endpoints.js";

const { modalTitle, pushView } = useModalView();
modalTitle.value = "Global Jobs";

const { apiGet, apiDelete } = useApi();

const jobEntries = ref([]);
const isLoading = ref(false);

async function loadGlobalJobs() {
  isLoading.value = true;
  try {
    const { ok, data } = await apiGet(EP_GLOBAL_JOBS);
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
    onReturn: () => { loadGlobalJobs(); emit("jobs:refresh"); },
  });
}

function startEditJob(entry) {
  pushView("JobConfig", {
    isGlobal: true,
    workspaceName: null,
    jobEntry: entry,
    onReturn: () => { loadGlobalJobs(); emit("jobs:refresh"); },
  });
}

async function deleteJob(entry) {
  try {
    await apiDelete(`${EP_GLOBAL_JOBS}/${encodeURIComponent(entry.name)}`);
    await loadGlobalJobs();
    emit("jobs:refresh");
  } catch { /* ignore */ }
}

onMounted(() => {
  loadGlobalJobs();
});
</script>

<style>
@import "../styles/settings-list.css";
</style>
