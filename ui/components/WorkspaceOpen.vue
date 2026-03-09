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
              <span v-html="renderIconStr(ws.icon || 'mdi-console', ws.icon_color, 18)"></span>
              <span class="picker-ws-header-text">
                <span class="picker-ws-name">{{ ws.name }}</span>
                <span class="picker-ws-branch">{{ ws.branch || '-' }}</span>
              </span>
            </button>
            <div class="picker-ws-top-meta">
              <GitActionBtn v-if="ws.is_git_repo && ws.behind > 0" icon="pull" title="Pull" :count="ws.behind" :running="isRunning(ws.name, 'pull')" btn-class="picker-ws-mini-btn pull-btn has-count" @action="doAction(ws, 'pull')" />
              <GitActionBtn v-if="ws.is_git_repo && ws.ahead > 0 && ws.has_upstream !== false" icon="push" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push')" btn-class="picker-ws-mini-btn push-btn has-count" @action="doAction(ws, 'push')" />
              <GitActionBtn v-if="ws.is_git_repo && ws.ahead > 0 && ws.has_upstream === false" icon="push-upstream" title="Push" :count="ws.ahead" :running="isRunning(ws.name, 'push-upstream')" btn-class="picker-ws-mini-btn upstream-btn" @action="doAction(ws, 'push-upstream')" />
              <button v-if="ws.is_git_repo && !ws.clean" type="button" class="git-badge dirty" v-html="dirtyBadgeHtml(ws)" @click="openDetail(ws)"></button>
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
                <span v-html="renderIconStr(job.icon || 'mdi-play', job.icon_color, 18)"></span>
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
import { computed, inject, reactive } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useAuthStore } from "../stores/auth.js";
import { useGitAction } from "../composables/useGitAction.js";
import { renderIconStr } from "../utils/render-icon.js";
import { emit } from "../app-bridge.js";
import GitActionBtn from "./GitActionBtn.vue";

const modalTitle = inject("modalTitle");
modalTitle.value = "ワークスペース";

const workspaceStore = useWorkspaceStore();
const auth = useAuthStore();
const { gitAction, isRunning } = useGitAction();

const wsJobs = reactive({});

function doAction(ws, action) {
  gitAction(ws.name, action, { branch: ws.branch });
}

const visibleWorkspaces = computed(() => workspaceStore.visibleWorkspaces);

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
  const files = ws.changed_files || 0;
  const ins = ws.insertions || 0;
  const del = ws.deletions || 0;
  const filePart = files > 0 ? `<span class="header-git-files">${files}F</span> ` : "";
  return `${filePart}<span class="diff-num-plus">+${ins}</span> <span class="diff-num-del">-${del}</span>`;
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
