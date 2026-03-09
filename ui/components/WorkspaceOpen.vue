<template>
  <div class="modal-scroll-body split-tab-scroll">
    <div class="split-tab-content">
      <div class="terminal-ws-list">
        <div
          v-for="ws in visibleWorkspaces"
          :key="ws.name"
          class="picker-ws-group"
        >
          <div class="picker-ws-row picker-ws-row-top">
            <button type="button" class="picker-ws-header-label" @click="selectWorkspace(ws)">
              <span v-html="renderIcon(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
              <span class="picker-ws-header-text">
                <span class="picker-ws-name">{{ ws.name }}</span>
                <span class="picker-ws-branch">{{ ws.branch || '-' }}</span>
              </span>
            </button>
            <div class="picker-ws-top-meta">
              <button v-if="ws.is_git_repo && ws.behind > 0" type="button" class="git-badge behind" :disabled="runningWs === ws.name" @click.stop="gitAction(ws, 'pull')">↓{{ ws.behind }}</button>
              <button v-if="ws.is_git_repo && ws.ahead > 0 && ws.has_upstream !== false" type="button" class="git-badge ahead" :disabled="runningWs === ws.name" @click.stop="gitAction(ws, 'push')">↑{{ ws.ahead }}</button>
              <button v-if="ws.is_git_repo && ws.ahead > 0 && ws.has_upstream === false" type="button" class="git-badge ahead" :disabled="runningWs === ws.name" @click.stop="gitAction(ws, 'push-upstream')">↑{{ ws.ahead }}</button>
              <span v-if="ws.is_git_repo && !ws.clean" class="git-badge dirty" v-html="dirtyBadgeHtml(ws)"></span>
            </div>
          </div>
          <div class="picker-ws-row picker-ws-row-bottom">
            <div class="picker-ws-icons picker-ws-icons-bottom">
              <button
                v-for="job in wsJobs[ws.name] || []"
                :key="job.name"
                type="button"
                class="picker-ws-icon-btn"
                :class="{ 'picker-ws-job-direct': job.terminal === false }"
                :title="job.label || job.name"
                @click="runJob(ws, job)"
              >
                <span v-html="renderIcon(job.icon || 'mdi-play', job.icon_color, 18)"></span>
              </button>
            </div>
            <button type="button" class="picker-ws-icon-btn" title="ファイル" @click="openDetail(ws)">
              <span class="mdi mdi-folder-outline"></span>
            </button>
          </div>
        </div>
        <div v-if="visibleWorkspaces.length === 0" class="clone-repo-empty">
          表示中のワークスペースがありません
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, reactive } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useAuthStore } from "../stores/auth.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "ワークスペース";

const workspaceStore = useWorkspaceStore();
const auth = useAuthStore();

const wsJobs = reactive({});
const runningWs = ref(null);

const ACTION_LABELS = {
  pull: "Pull",
  push: "Push",
  "push-upstream": "Push (upstream設定)",
};

async function gitAction(ws, action) {
  if (runningWs.value) return;
  const label = ACTION_LABELS[action] || action;
  if (!confirm(`${ws.name}: ${label} を実行しますか？`)) return;
  runningWs.value = ws.name;
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(ws.name)}/${action}`, {
      method: "POST",
    });
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => null);
      emit("toast:show", { message: data?.stderr || `${label}に失敗しました`, type: "error" });
      return;
    }
    const data = await res.json();
    if (data.exit_code !== 0) {
      emit("toast:show", { message: data.stderr || `${label}に失敗しました`, type: "error" });
      return;
    }
    emit("toast:show", { message: `${ws.name}: ${label}完了`, type: "success" });
    await workspaceStore.fetchStatuses(auth);
  } catch (e) {
    emit("toast:show", { message: e.message, type: "error" });
  } finally {
    runningWs.value = null;
  }
}

const visibleWorkspaces = computed(() => workspaceStore.visibleWorkspaces);

function renderIcon(icon, color, size) {
  return renderIconStr(icon, color, size);
}

async function load() {
  await workspaceStore.fetchStatuses(auth);
  fetchAllJobs();
}

async function fetchAllJobs() {
  for (const ws of visibleWorkspaces.value) {
    if (wsJobs[ws.name]) continue;
    loadJobs(ws.name);
  }
}

async function loadJobs(wsName) {
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(wsName)}/jobs`);
    if (!res || !res.ok) return;
    const data = await res.json();
    const entries = Object.entries(data)
      .filter(([name]) => name !== "terminal")
      .map(([name, job]) => ({ name, ...job }));
    wsJobs[wsName] = entries;
  } catch {
    // ignore
  }
}

function dirtyBadgeHtml(ws) {
  const ins = ws.insertions || 0;
  const del = ws.deletions || 0;
  return `M <span class="diff-num-plus">+${ins}</span> <span class="diff-num-del">-${del}</span>`;
}

function openDetail(ws) {
  workspaceStore.selectedWorkspace = ws.name;
  emit("git:openFileModal");
}

function selectWorkspace(ws) {
  emit("modal:close");
  emit("terminal:launch", {
    workspace: ws.name,
    icon: ws.icon,
    iconColor: ws.icon_color,
  });
}

function runJob(ws, job) {
  emit("modal:close");
  if (job.terminal === false) {
    emit("job:exec", { jobName: job.name, job, workspace: ws.name });
    return;
  }
  if (job.confirm !== false) {
    const preview = job.command ? (job.command.length > 300 ? job.command.slice(0, 300) + "..." : job.command) : job.name;
    if (!confirm(`${job.label || job.name}\n\n${preview}`)) return;
  }
  emit("terminal:launch", {
    workspace: ws.name,
    icon: ws.icon,
    iconColor: ws.icon_color,
    jobName: job.name,
    jobLabel: job.label,
    jobIcon: job.icon,
    jobIconColor: job.icon_color,
    initialCommand: job.command,
  });
}

defineExpose({ load });
</script>
