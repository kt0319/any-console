<template>
  <div class="jobs-pane-wrapper">
    <div class="modal-scroll-body">
      <div class="job-item-row hover-bg">
        <button type="button" class="job-item" @click="openTerminal">
          <span class="mdi mdi-console job-item-icon" aria-hidden="true"></span>
          <span class="job-item-label">Terminal</span>
        </button>
      </div>
      <div
        v-for="job in commonJobs"
        :key="'c-' + job.name"
        class="job-item-row hover-bg"
        :class="{ 'job-item-detached': job.detached_tab }"
      >
        <button type="button" class="job-item" @click="runJob(job)">
          <span class="job-item-icon" v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
          <span class="job-item-label">{{ job.label || job.name }}</span>
        </button>
        <button v-if="props.editMode" type="button" class="job-item-edit-btn" title="Edit" aria-label="Edit" @click.stop="startEditJob(job, true)">
          <span class="mdi mdi-pencil-outline" aria-hidden="true"></span>
        </button>
      </div>

      <div v-if="localJobs.length" class="job-section-header job-section-subheader">
        <span>Workspace jobs</span>
      </div>
      <div
        v-for="job in localJobs"
        :key="'l-' + job.name"
        class="job-item-row hover-bg"
        :class="{ 'job-item-detached': job.detached_tab }"
      >
        <button type="button" class="job-item" @click="runJob(job)">
          <span class="job-item-icon" v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
          <span class="job-item-label">{{ job.label || job.name }}</span>
        </button>
        <button v-if="props.editMode" type="button" class="job-item-edit-btn" title="Edit" aria-label="Edit" @click.stop="startEditJob(job, false)">
          <span class="mdi mdi-pencil-outline" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, onMounted, watch, onBeforeUnmount } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useRecentJobs } from "../composables/useRecentJobs.ts";
import { useApi } from "../composables/useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useConfirm } from "../composables/useConfirm.ts";
import { emit, on } from "../app-bridge.ts";
import { renderIconStr } from "../utils/render-icon.ts";
import { EP_COMMON_JOBS } from "../utils/endpoints.ts";
import { jobCommandPreview } from "../utils/format.ts";

const props = defineProps({
  // ワークスペース一覧のインライン展開など、グローバルな selectedWorkspace と
  // 独立して表示したい場合に指定する。省略時は従来通り selectedWorkspace に従う。
  workspace: { type: String, default: null },
  // ワークスペース一覧のEditモードと連動させ、各Jobの編集ボタンを
  // Editモード中だけ表示する（誤操作しやすい操作を通常表示から分離する）。
  editMode: { type: Boolean, default: false },
});

const pushView = inject("pushView");

// common jobs は全ワークスペース共通・変更頻度が低いためモジュール単位で1回だけ保持する。
// workspace-local jobs は ws 単位でキャッシュする。いずれも jobs:refresh で無効化する。
let commonJobsCache = null;
const wsJobsCache = {};

const workspaceStore = useWorkspaceStore();
const { recordJob } = useRecentJobs();
const { apiGet, wsEndpoint } = useApi();
const { confirm } = useConfirm();

const commonJobs = ref([]);
const localJobs = ref([]);

const workspace = computed(() => props.workspace || workspaceStore.selectedWorkspace);
const ws = computed(() =>
  workspaceStore.allWorkspaces.find((w) => w.name === workspace.value),
);

function applyJobs(wsName) {
  commonJobs.value = commonJobsCache || [];
  localJobs.value = wsName ? (wsJobsCache[wsName] || []) : [];
}

async function loadCommonJobs() {
  if (commonJobsCache) return;
  const { ok, data } = await getWithRetry(apiGet, EP_COMMON_JOBS);
  if (!ok) return;
  commonJobsCache = Object.entries(data)
    .filter(([n]) => n !== "terminal")
    .map(([n, job]) => ({ name: n, ...job }));
}

async function loadWsJobs(wsName) {
  if (wsJobsCache[wsName]) return;
  const { ok, data } = await getWithRetry(apiGet, wsEndpoint(wsName, "jobs"));
  if (!ok) return;
  wsJobsCache[wsName] = Object.entries(data)
    .filter(([n, job]) => n !== "terminal" && !job.common)
    .map(([n, job]) => ({ name: n, ...job }));
}

async function load() {
  const wsName = workspace.value;
  if (!wsName) { applyJobs(null); return; }
  try {
    await Promise.all([loadCommonJobs(), loadWsJobs(wsName)]);
    applyJobs(wsName);
  } catch { /* ignore */ }
}

function openTerminal() {
  const wsName = workspace.value;
  if (!wsName) return;
  // ワークスペースを開いてもサイドバー/設定は閉じない（PCはターミナルに
  // 被せず横に並ぶため隠す必要が無く、続けて他のワークスペースも開けるように）。
  emit("terminal:launch", {
    workspace: wsName,
    icon: ws.value?.icon,
    iconColor: ws.value?.icon_color,
  });
}

async function runJob(job) {
  const wsName = workspace.value;
  if (!wsName) return;
  if (job.confirm !== false) {
    const preview = jobCommandPreview(job.command, job.name);
    if (!await confirm(`${job.label || job.name}\n\n${preview}`)) return;
  }
  if (ws.value) recordJob(ws.value, job);
  // ワークスペースを開いてもサイドバー/設定は閉じない（上のopenTerminalと同様）。
  emit("terminal:launch", {
    workspace: wsName,
    icon: ws.value?.icon,
    iconColor: ws.value?.icon_color,
    jobName: job.name,
    jobLabel: job.label,
    jobIcon: job.icon,
    jobIconColor: job.icon_color,
    initialCommand: job.command,
    detached: !!job.detached_tab,
  });
}

function startEditJob(job, isCommon) {
  const wsName = workspace.value;
  if (!wsName) return;
  pushView("JobConfig", {
    workspaceName: wsName,
    isCommon,
    jobEntry: { name: job.name, job: { ...job, common: isCommon } },
    onReturn: () => emit("jobs:refresh"),
  });
}

const offJobsRefresh = on("jobs:refresh", () => {
  commonJobsCache = null;
  for (const key of Object.keys(wsJobsCache)) delete wsJobsCache[key];
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

.job-item-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: 44px;
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.job-item {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  height: 100%;
  background: transparent;
  border: none;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
  color: var(--text-primary);
}

.job-item-detached {
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

.job-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-tertiary) 60%, transparent);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.job-section-header:first-child {
  border-top: none;
}

.job-section-subheader {
  font-size: 10px;
  color: var(--text-muted);
  background: transparent;
}

.job-section-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.job-item-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 12px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

</style>
