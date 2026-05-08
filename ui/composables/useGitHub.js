import { ref, computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";

const _countCache = {};

export function getCachedCount(workspace, key) {
  const c = _countCache[`${workspace}:${key}`];
  return c ?? null;
}

function setCountCache(workspace, key, count) {
  _countCache[`${workspace}:${key}`] = count;
}

export const RUN_STATUS = {
  success: { icon: "✓", cls: "github-run-success" },
  failure: { icon: "✗", cls: "github-run-failure" },
  cancelled: { icon: "○", cls: "github-run-cancelled" },
  in_progress: { icon: "◗", cls: "github-run-progress" },
  queued: { icon: "◗", cls: "github-run-progress" },
  waiting: { icon: "◗", cls: "github-run-progress" },
};

export function runStatusIcon(status) {
  return RUN_STATUS[status]?.icon || "?";
}

export function runStatusClass(status) {
  return RUN_STATUS[status]?.cls || "";
}

export function labelStyle(color) {
  if (!color) return {};
  const c = color.replace(/^#/, "");
  return {
    backgroundColor: `#${c}33`,
    color: `#${c}`,
    border: `1px solid #${c}66`,
  };
}

export function openUrl(url) {
  if (url) window.open(url, "_blank");
}

export function useGitHub() {
  const workspaceStore = useWorkspaceStore();
  const { apiGet, wsEndpoint } = useApi();

  const githubUrl = ref("");

  const repoName = computed(() => {
    if (!githubUrl.value) return "";
    const m = githubUrl.value.match(/github\.com\/(.+?)(?:\.git)?$/);
    return m ? m[1] : githubUrl.value;
  });

  function loadWorkspaceGithubUrl() {
    const ws = workspaceStore.currentWorkspace;
    githubUrl.value = ws?.github_url || "";
    return githubUrl.value;
  }

  async function _loadList(endpoint, countKey, mapper, listRef, loadingRef, errorRef) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    loadingRef.value = true;
    errorRef.value = "";
    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, endpoint));
      if (!ok) { errorRef.value = "Failed to fetch"; return; }
      if (data.status !== "ok") { errorRef.value = data.message || "Failed to fetch"; return; }
      const result = (data.data || []).map(mapper);
      listRef.value = result;
      setCountCache(workspace, countKey, result.length);
    } catch (e) {
      errorRef.value = e.message;
    } finally {
      loadingRef.value = false;
    }
  }

  function _makeLoader(endpoint, countKey, mapper) {
    return (listRef, loadingRef, errorRef) => _loadList(endpoint, countKey, mapper, listRef, loadingRef, errorRef);
  }

  const loadIssues = _makeLoader("github/issues", "issues", (item) => ({
    number: item.number,
    title: item.title,
    author: item.author?.login || "",
    labels: item.labels || [],
  }));

  const loadPRs = _makeLoader("github/pulls", "prs", (item) => ({
    number: item.number,
    title: item.title,
    author: item.author?.login || "",
    isDraft: !!item.isDraft,
    headRefName: item.headRefName || "",
    labels: item.labels || [],
  }));

  const loadActions = _makeLoader("github/runs", "actions", (r) => ({
    id: r.databaseId || r.id,
    name: r.name || r.workflowName || "",
    status: r.status || "",
    conclusion: r.conclusion || "",
    headBranch: r.headBranch || "",
    url: r.url || "",
  }));

  return { githubUrl, repoName, loadWorkspaceGithubUrl, loadIssues, loadPRs, loadActions };
}
