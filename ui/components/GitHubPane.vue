<template>
  <div class="git-github-pane-wrapper">
    <div class="modal-scroll-body">
      <div v-if="!githubUrl" class="text-muted-center">No GitHub repository configured</div>
      <template v-else>
        <div class="github-section-title github-section-link" @click="openUrl(githubUrl)">
          {{ repoName }}
        </div>

        <div class="github-section-title github-section-link" @click="openUrl(githubUrl + '/issues')">
          Issues
          <span :class="['github-section-badge', { 'github-badge-loading': isIssuesLoading }]">
            {{ isIssuesLoading ? "…" : issueItems.length }}
          </span>
        </div>
        <div class="github-section-body">
          <div v-if="isIssuesLoading" style="color:var(--text-muted);padding:8px">Loading...</div>
          <div v-else-if="issuesLoadError" style="color:var(--diff-del);padding:8px">{{ issuesLoadError }}</div>
          <div
            v-for="item in issueItems"
            :key="'issue-' + item.number"
            class="github-item"
            @click="openUrl(githubUrl + '/issues/' + item.number)"
          >
            <span class="github-item-number">#{{ item.number }}</span>
            <span class="github-item-title">{{ item.title }}</span>
            <span v-if="item.author" class="github-item-author">{{ item.author }}</span>
            <span v-if="item.labels && item.labels.length" class="github-labels">
              <span
                v-for="label in item.labels"
                :key="label.name"
                class="github-label"
                :style="labelStyle(label.color)"
              >{{ label.name }}</span>
            </span>
          </div>
        </div>

        <div class="github-section-title github-section-link" @click="openUrl(githubUrl + '/pulls')">
          Pull Requests
          <span :class="['github-section-badge', { 'github-badge-loading': isPullRequestsLoading }]">
            {{ isPullRequestsLoading ? "…" : pullRequestItems.length }}
          </span>
        </div>
        <div class="github-section-body">
          <div v-if="isPullRequestsLoading" style="color:var(--text-muted);padding:8px">Loading...</div>
          <div v-else-if="pullRequestsLoadError" style="color:var(--diff-del);padding:8px">{{ pullRequestsLoadError }}</div>
          <div
            v-for="item in pullRequestItems"
            :key="'pr-' + item.number"
            class="github-item"
            @click="openUrl(githubUrl + '/pull/' + item.number)"
          >
            <span class="github-item-number">#{{ item.number }}</span>
            <span class="github-item-title">{{ item.title }}</span>
            <span v-if="item.isDraft" class="github-draft">Draft</span>
            <span v-if="item.headRefName" class="github-branch">{{ item.headRefName }}</span>
            <span v-if="item.author" class="github-item-author">{{ item.author }}</span>
            <span v-if="item.labels && item.labels.length" class="github-labels">
              <span
                v-for="label in item.labels"
                :key="label.name"
                class="github-label"
                :style="labelStyle(label.color)"
              >{{ label.name }}</span>
            </span>
          </div>
        </div>

        <div class="github-section-title github-section-link" @click="openUrl(githubUrl + '/actions')">
          Actions
          <span :class="['github-section-badge', { 'github-badge-loading': isWorkflowRunsLoading }]">
            {{ isWorkflowRunsLoading ? "…" : workflowRuns.length }}
          </span>
        </div>
        <div class="github-section-body">
          <div v-if="isWorkflowRunsLoading" style="color:var(--text-muted);padding:8px">Loading...</div>
          <div v-else-if="workflowRunsLoadError" style="color:var(--diff-del);padding:8px">{{ workflowRunsLoadError }}</div>
          <div
            v-for="run in workflowRuns"
            :key="'run-' + run.id"
            class="github-item"
            @click="openUrl(run.url)"
          >
            <span :class="['github-run-status', runStatusClass(run.conclusion || run.status)]">
              {{ runStatusIcon(run.conclusion || run.status) }}
            </span>
            <span class="github-item-title">{{ run.name }}</span>
            <span class="github-item-meta">{{ run.headBranch }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, inject, computed, onMounted } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "../composables/useApi.js";

const modalTitle = inject("modalTitle");
modalTitle.value = "GitHub";

const { apiGet, wsEndpoint } = useApi();
const workspaceStore = useWorkspaceStore();

const githubUrl = ref("");
const issueItems = ref([]);
const pullRequestItems = ref([]);
const workflowRuns = ref([]);
const isIssuesLoading = ref(false);
const isPullRequestsLoading = ref(false);
const isWorkflowRunsLoading = ref(false);
const issuesLoadError = ref("");
const pullRequestsLoadError = ref("");
const workflowRunsLoadError = ref("");

const RUN_STATUS = {
  success: { icon: "✓", cls: "github-run-success" },
  failure: { icon: "✗", cls: "github-run-failure" },
  cancelled: { icon: "○", cls: "github-run-cancelled" },
  in_progress: { icon: "◗", cls: "github-run-progress" },
  queued: { icon: "◗", cls: "github-run-progress" },
  waiting: { icon: "◗", cls: "github-run-progress" },
};

const repoName = computed(() => {
  if (!githubUrl.value) return "";
  const m = githubUrl.value.match(/github\.com\/(.+?)(?:\.git)?$/);
  return m ? m[1] : githubUrl.value;
});

function runStatusIcon(status) {
  return RUN_STATUS[status]?.icon || "?";
}

function runStatusClass(status) {
  return RUN_STATUS[status]?.cls || "";
}

function labelStyle(color) {
  if (!color) return {};
  const c = color.replace(/^#/, "");
  return {
    backgroundColor: `#${c}33`,
    color: `#${c}`,
    border: `1px solid #${c}66`,
  };
}

function openUrl(url) {
  if (url) window.open(url, "_blank");
}

async function loadGitHubPaneData() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;

  const ws = workspaceStore.currentWorkspace;
  githubUrl.value = ws?.github_url || "";
  if (!githubUrl.value) return;

  loadGitHubSection("issues", issueItems, isIssuesLoading, issuesLoadError, workspace);
  loadGitHubSection("pulls", pullRequestItems, isPullRequestsLoading, pullRequestsLoadError, workspace);
  loadWorkflowRuns(workspace);
}

async function loadGitHubSection(type, listRef, loadingRef, errorRef, workspace) {
  loadingRef.value = true;
  errorRef.value = "";
  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `github/${type}`));
    if (!ok) { errorRef.value = "Failed to fetch"; return; }
    if (data.status !== "ok") { errorRef.value = data.message || "Failed to fetch"; return; }
    listRef.value = (data.data || []).map((item) => ({
      number: item.number,
      title: item.title,
      author: item.author?.login || "",
      isDraft: !!item.isDraft,
      headRefName: item.headRefName || "",
      labels: item.labels || [],
    }));
  } catch (e) {
    errorRef.value = e.message;
  } finally {
    loadingRef.value = false;
  }
}

async function loadWorkflowRuns(workspace) {
  isWorkflowRunsLoading.value = true;
  workflowRunsLoadError.value = "";
  try {
    const { ok, data } = await apiGet(wsEndpoint(workspace, "github/runs"));
    if (!ok) { workflowRunsLoadError.value = "Failed to fetch"; return; }
    if (data.status !== "ok") { workflowRunsLoadError.value = data.message || "Failed to fetch"; return; }
    workflowRuns.value = (data.data || []).map((r) => ({
      id: r.databaseId || r.id,
      name: r.name || r.workflowName || "",
      status: r.status || "",
      conclusion: r.conclusion || "",
      headBranch: r.headBranch || "",
      url: r.url || "",
    }));
  } catch (e) {
    workflowRunsLoadError.value = e.message;
  } finally {
    isWorkflowRunsLoading.value = false;
  }
}

onMounted(() => {
  loadGitHubPaneData();
});
</script>

<style scoped>
.git-github-pane-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.github-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}

.github-section-title.github-section-link {
  cursor: pointer;
  color: var(--accent);
  background: transparent;
  border-radius: var(--radius);
  margin: 6px 8px;
  border-bottom: none;
  justify-content: space-between;
}

.github-section-badge {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
}

.github-badge-loading {
  animation: github-badge-pulse 1s ease-in-out infinite;
}

@keyframes github-badge-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.github-section-title.github-repo-name {
  font-size: 15px;
  background: none;
  border-radius: 0;
  margin: 0;
  border-bottom: 1px solid var(--border);
  justify-content: flex-start;
}

.github-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
}

.github-item-number {
  color: var(--text-muted);
  font-size: 12px;
  flex-shrink: 0;
}

.github-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.github-item-author {
  font-size: 11px;
  color: var(--text-muted);
}

.github-draft {
  font-size: 11px;
  color: var(--warning);
  background: var(--warning-bg-20);
  padding: 1px 6px;
  border-radius: 4px;
}

.github-branch {
  font-size: 11px;
  color: var(--accent);
  background: var(--accent-bg-20);
  padding: 1px 6px;
  border-radius: 4px;
}

.github-labels {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}

.github-label {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.github-run-icon {
  flex-shrink: 0;
  font-size: 13px;
}

.github-run-success {
  color: var(--success);
}

.github-run-failure {
  color: var(--error);
}

.github-run-cancelled {
  color: var(--text-muted);
}

.github-run-progress {
  color: var(--warning);
}

.github-run-workflow {
  font-size: 11px;
  color: var(--text-muted);
}

.github-error,
.github-loading {
  padding: 12px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}
</style>
