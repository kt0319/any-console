<template>
  <div class="git-github-pane-wrapper">
    <div class="modal-scroll-body" ref="contentEl">
      <div v-if="!githubUrl" style="color:var(--text-muted);padding:16px;text-align:center">GitHubリポジトリが設定されていません</div>
      <template v-else>
        <div class="github-section-title github-section-link" @click="openUrl(githubUrl)">
          {{ repoName }}
        </div>

        <div class="github-section-title github-section-link" @click="openUrl(githubUrl + '/issues')">
          Issues
          <span :class="['github-section-badge', { 'github-badge-loading': issuesLoading }]">
            {{ issuesLoading ? "…" : issues.length }}
          </span>
        </div>
        <div class="github-section-body">
          <div v-if="issuesLoading" style="color:var(--text-muted);padding:8px">読み込み中...</div>
          <div v-else-if="issuesError" style="color:var(--diff-del);padding:8px">{{ issuesError }}</div>
          <div
            v-for="item in issues"
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
          <span :class="['github-section-badge', { 'github-badge-loading': pullsLoading }]">
            {{ pullsLoading ? "…" : pulls.length }}
          </span>
        </div>
        <div class="github-section-body">
          <div v-if="pullsLoading" style="color:var(--text-muted);padding:8px">読み込み中...</div>
          <div v-else-if="pullsError" style="color:var(--diff-del);padding:8px">{{ pullsError }}</div>
          <div
            v-for="item in pulls"
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
          <span :class="['github-section-badge', { 'github-badge-loading': runsLoading }]">
            {{ runsLoading ? "…" : runs.length }}
          </span>
        </div>
        <div class="github-section-body">
          <div v-if="runsLoading" style="color:var(--text-muted);padding:8px">読み込み中...</div>
          <div v-else-if="runsError" style="color:var(--diff-del);padding:8px">{{ runsError }}</div>
          <div
            v-for="run in runs"
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
import { ref, computed } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { useWorkspaceStore } from "../stores/workspace.js";

const auth = useAuthStore();
const workspaceStore = useWorkspaceStore();

const githubUrl = ref("");
const issues = ref([]);
const pulls = ref([]);
const runs = ref([]);
const issuesLoading = ref(false);
const pullsLoading = ref(false);
const runsLoading = ref(false);
const issuesError = ref("");
const pullsError = ref("");
const runsError = ref("");
const contentEl = ref(null);

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

async function load() {
  const workspace = workspaceStore.selectedWorkspace;
  if (!workspace) return;

  const ws = workspaceStore.allWorkspaces.find((w) => w.name === workspace);
  githubUrl.value = ws?.github_url || "";
  if (!githubUrl.value) return;

  loadSection("issues", issues, issuesLoading, issuesError, workspace);
  loadSection("pulls", pulls, pullsLoading, pullsError, workspace);
  loadRuns(workspace);
}

async function loadSection(type, listRef, loadingRef, errorRef, workspace) {
  loadingRef.value = true;
  errorRef.value = "";
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/github/${type}`);
    if (!res || !res.ok) { errorRef.value = "取得に失敗しました"; return; }
    const data = await res.json();
    if (data.status !== "ok") { errorRef.value = data.message || "取得に失敗しました"; return; }
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

async function loadRuns(workspace) {
  runsLoading.value = true;
  runsError.value = "";
  try {
    const res = await auth.apiFetch(`/workspaces/${encodeURIComponent(workspace)}/github/runs`);
    if (!res || !res.ok) { runsError.value = "取得に失敗しました"; return; }
    const data = await res.json();
    if (data.status !== "ok") { runsError.value = data.message || "取得に失敗しました"; return; }
    runs.value = (data.data || []).map((r) => ({
      id: r.databaseId || r.id,
      name: r.name || r.workflowName || "",
      status: r.status || "",
      conclusion: r.conclusion || "",
      headBranch: r.headBranch || "",
      url: r.url || "",
    }));
  } catch (e) {
    runsError.value = e.message;
  } finally {
    runsLoading.value = false;
  }
}

defineExpose({ load });
</script>
