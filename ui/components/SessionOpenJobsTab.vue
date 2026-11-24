<template>
  <div class="session-open-jobs">
    <div v-if="isLoading" class="workspace-list-empty loading-dots">Loading</div>
    <template v-else>
      <section v-for="category in categories" :key="category.key">
        <div class="ws-group-header">
          <button type="button" class="ws-group-toggle" :aria-expanded="!collapsedGroups.has(category.collapseKey)" @click="toggleGroup(category.collapseKey)">
            <span v-if="category.icon" v-html="renderIconStr(category.icon, category.iconColor, 16)"></span>
            <span class="ws-group-title">{{ category.title }}</span>
          </button>
          <span class="mdi ws-group-chevron" :class="collapsedGroups.has(category.collapseKey) ? 'mdi-chevron-right' : 'mdi-chevron-down'" aria-hidden="true" @click="toggleGroup(category.collapseKey)"></span>
        </div>
        <div v-for="job in category.jobs" v-show="!collapsedGroups.has(category.collapseKey)" :key="job.name" class="job-item-row hover-bg" :class="{ 'job-item-detached': job.detached }">
          <div class="job-item session-open-job-name">
            <span class="job-item-icon" v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
            <span class="job-item-label">{{ job.label || job.name }}</span>
            <span v-if="job.default" class="job-default-badge" data-tooltip="Runs when a workspace is tapped">default</span>
          </div>
          <button v-if="category.workspace" type="button" class="job-item-edit-btn session-open-job-run" data-tooltip="Run" :aria-label="`Run ${job.label || job.name}`" @click="runJob(category.workspace, job)">
            <span class="mdi mdi-play" aria-hidden="true"></span>
          </button>
          <button type="button" class="job-item-edit-btn session-open-job-edit" data-tooltip="Edit" aria-label="Edit" @click="editJob(category.workspace, job)">
            <span class="mdi mdi-pencil-outline" aria-hidden="true"></span>
          </button>
        </div>
      </section>
      <div v-if="categories.length === 0" class="workspace-list-empty">No jobs to display</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useCollapsedWorkspaceGroups } from "../composables/useCollapsedWorkspaceGroups.ts";
import { useRunJob } from "../composables/useRunJob.ts";
import { useApi } from "../composables/useApi.ts";
import { useBusListener } from "../composables/useBusListener.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { EP_COMMON_JOBS, EP_JOBS_WORKSPACES } from "../utils/endpoints.ts";
import { emit } from "../app-bridge.ts";

interface Job {
  name: string;
  label?: string;
  icon?: string;
  icon_color?: string;
  command?: string;
  confirm?: boolean;
  detached?: boolean;
  default?: boolean;
  common?: boolean;
}

const pushView = inject<(view: string, state?: Record<string, any>) => void>("pushView")!;
const GLOBAL_JOB_ICON = "mdi-earth";

const workspaceStore = useWorkspaceStore();
const { collapsedGroups, toggleGroup } = useCollapsedWorkspaceGroups();
const { runJobInWorkspace } = useRunJob();
const { apiGet } = useApi();

const jobsByWorkspace = ref<Record<string, Record<string, Omit<Job, "name">>>>({});
const globalJobsByName = ref<Record<string, Omit<Job, "name">>>({});
const isLoading = ref(true);

const globalJobs = computed(() =>
  Object.entries(globalJobsByName.value)
    .filter(([name]) => name !== "terminal")
    .map(([name, job]) => ({ name, ...job }) as Job),
);

// 共通（Global）ジョブは /jobs/workspaces では全ワークスペースへ重複して含まれるため、
// ワークスペース単位にはワークスペース固有のジョブだけを出し、共通ジョブは別カテゴリで出す。
// ジョブがあるカテゴリだけ表示する。
const categories = computed(() => [
  { key: "global", collapseKey: "job:global", title: "Global", icon: GLOBAL_JOB_ICON, iconColor: "", workspace: null as Record<string, any> | null, jobs: globalJobs.value },
  ...workspaceStore.allWorkspaces.map((workspace) => ({
    key: workspace.name,
    collapseKey: `job:${workspace.name}`,
    title: workspace.name as string,
    icon: (workspace.icon || "") as string,
    iconColor: (workspace.icon_color || "") as string,
    workspace: workspace as Record<string, any> | null,
    jobs: Object.entries(jobsByWorkspace.value[workspace.name] || {})
      .filter(([name, job]) => name !== "terminal" && !job.common)
      .map(([name, job]) => ({ name, ...job }) as Job),
  })),
].filter((category) => category.jobs.length > 0));

async function loadJobs() {
  try {
    const [workspaceJobs, commonJobs] = await Promise.all([
      getWithRetry(apiGet, EP_JOBS_WORKSPACES),
      getWithRetry(apiGet, EP_COMMON_JOBS),
    ]);
    if (workspaceJobs.ok) jobsByWorkspace.value = workspaceJobs.data;
    if (commonJobs.ok) globalJobsByName.value = commonJobs.data;
  } finally {
    isLoading.value = false;
  }
}

async function runJob(workspace: Record<string, any>, job: Job) {
  await runJobInWorkspace(workspace, job);
}

function editJob(workspace: Record<string, any> | null, job: Job) {
  pushView("JobConfig", {
    workspaceName: workspace?.name ?? "",
    isCommon: !workspace,
    jobEntry: { name: job.name, job: { ...job, common: !workspace } },
    onReturn: () => emit("jobs:refresh"),
  });
}

useBusListener("jobs:refresh", loadJobs);

onMounted(loadJobs);
</script>

<style scoped>
.session-open-job-name {
  cursor: default;
}

.session-open-job-run {
  margin-right: 6px;
}
</style>
