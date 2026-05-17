<template>
  <div class="jobs-pane-wrapper">
    <div class="modal-scroll-body">
      <div class="job-item" @click="openTerminal">
        <span class="mdi mdi-console job-item-icon" aria-hidden="true"></span>
        <span class="job-item-label">Terminal</span>
      </div>

      <template v-if="commonJobs.length">
        <div class="job-section-header">Common</div>
        <div
          v-for="job in commonJobs"
          :key="job.name"
          class="job-item"
          :class="{ 'job-item-hidden': job.hidden_tab }"
          @click="runJob(job)"
        >
          <span class="job-item-icon" v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
          <span class="job-item-label">{{ job.label || job.name }}</span>
          <span v-if="job.description" class="job-item-desc">{{ job.description }}</span>
        </div>
      </template>

      <template v-if="localJobs.length">
        <div class="job-section-header">Local</div>
        <div
          v-for="job in localJobs"
          :key="job.name"
          class="job-item"
          :class="{ 'job-item-hidden': job.hidden_tab }"
          @click="runJob(job)"
        >
          <span class="job-item-icon" v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
          <span class="job-item-label">{{ job.label || job.name }}</span>
          <span v-if="job.description" class="job-item-desc">{{ job.description }}</span>
        </div>
      </template>

      <div v-if="!commonJobs.length && !localJobs.length" class="text-muted-center">No jobs configured</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useRecentJobs } from "../composables/useRecentJobs.js";
import { useApi } from "../composables/useApi.js";
import { useConfirm } from "../composables/useConfirm.js";
import { emit, on } from "../app-bridge.js";
import { renderIconStr } from "../utils/render-icon.js";
import { EP_JOBS_WORKSPACES } from "../utils/endpoints.js";

const jobsCache = {};

const workspaceStore = useWorkspaceStore();
const { recordJob } = useRecentJobs();
const { apiGet } = useApi();
const { confirm } = useConfirm();

const commonJobs = ref([]);
const localJobs = ref([]);

const workspace = computed(() => workspaceStore.selectedWorkspace);
const ws = computed(() =>
  workspaceStore.allWorkspaces.find((w) => w.name === workspace.value),
);

function applyJobs(wsName) {
  const cached = jobsCache[wsName];
  if (!cached) {
    commonJobs.value = [];
    localJobs.value = [];
    return;
  }
  commonJobs.value = cached.filter((j) => j.common);
  localJobs.value = cached.filter((j) => !j.common);
}

async function load() {
  const wsName = workspace.value;
  if (!wsName) { applyJobs(null); return; }
  if (jobsCache[wsName]) { applyJobs(wsName); return; }
  try {
    const { ok, data } = await apiGet(EP_JOBS_WORKSPACES);
    if (!ok) return;
    for (const [name, jobs] of Object.entries(data)) {
      jobsCache[name] = Object.entries(jobs)
        .filter(([n]) => n !== "terminal")
        .map(([n, job]) => ({ name: n, ...job }));
    }
    applyJobs(wsName);
  } catch { /* ignore */ }
}

function openTerminal() {
  const wsName = workspace.value;
  if (!wsName) return;
  emit("terminal:launch", {
    workspace: wsName,
    icon: ws.value?.icon,
    iconColor: ws.value?.icon_color,
  });
  emit("modal:close");
}

async function runJob(job) {
  const wsName = workspace.value;
  if (!wsName) return;
  if (job.confirm !== false) {
    const preview = job.command ? (job.command.length > 300 ? job.command.slice(0, 300) + "..." : job.command) : job.name;
    if (!await confirm(`${job.label || job.name}\n\n${preview}`)) return;
  }
  if (ws.value) recordJob(ws.value, job);
  emit("terminal:launch", {
    workspace: wsName,
    icon: ws.value?.icon,
    iconColor: ws.value?.icon_color,
    jobName: job.name,
    jobLabel: job.label,
    jobIcon: job.icon,
    jobIconColor: job.icon_color,
    initialCommand: job.command,
    hidden: !!job.hidden_tab,
  });
  emit("modal:close");
}

const offJobsRefresh = on("jobs:refresh", () => {
  for (const key of Object.keys(jobsCache)) delete jobsCache[key];
  load();
});

onMounted(() => load());
onBeforeUnmount(() => offJobsRefresh());

watch(workspace, () => load());

defineExpose({ load });
</script>

<style scoped>
.jobs-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.job-item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  height: 44px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: background 0.15s;
}

.job-item-hidden {
  opacity: 0.6;
}

.job-item-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  font-size: 18px;
  line-height: 1;
  color: var(--text-muted);
}

.job-item-label {
  flex-shrink: 0;
}

.job-item-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

.job-section-header {
  padding: 12px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

@media (hover: hover) and (pointer: fine) {
  .job-item:hover {
    background: var(--bg-tertiary);
  }
}
</style>
