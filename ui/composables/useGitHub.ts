import { ref, computed, type Ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { openExternal } from "../utils/open-external.ts";
import { mapGitHubPR, mapGitHubRun } from "../utils/github-runs.ts";

const _countCache: Record<string, number> = {};

export function getCachedCount(workspace: string, key: string): number | null {
  const c = _countCache[`${workspace}:${key}`];
  return c ?? null;
}

function setCountCache(workspace: string, key: string, count: number) {
  _countCache[`${workspace}:${key}`] = count;
}

const RUN_STATUS: Record<string, { icon: string, cls: string }> = {
  success: { icon: "✓", cls: "github-run-success" },
  failure: { icon: "✗", cls: "github-run-failure" },
  cancelled: { icon: "○", cls: "github-run-cancelled" },
  in_progress: { icon: "◗", cls: "github-run-progress" },
  queued: { icon: "◗", cls: "github-run-progress" },
  waiting: { icon: "◗", cls: "github-run-progress" },
};

export function runStatusIcon(status: string) {
  return RUN_STATUS[status]?.icon || "?";
}

export function runStatusClass(status: string) {
  return RUN_STATUS[status]?.cls || "";
}

export function labelStyle(color: string | null | undefined) {
  if (!color) return {};
  const c = color.replace(/^#/, "");
  return {
    backgroundColor: `#${c}33`,
    color: `#${c}`,
    border: `1px solid #${c}66`,
  };
}

export function openUrl(url: string) {
  openExternal(url);
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

  function loadWorkspaceGitHubUrl() {
    const ws = workspaceStore.currentWorkspace;
    githubUrl.value = ws?.github_url || "";
    return githubUrl.value;
  }

  async function _loadList(
    endpoint: string,
    countKey: string,
    mapper: (item: any) => any,
    listRef: Ref<any[]>,
    loadingRef: Ref<boolean>,
    errorRef: Ref<string>,
  ) {
    const workspace = workspaceStore.selectedWorkspace;
    if (!workspace) return;
    loadingRef.value = true;
    errorRef.value = "";
    try {
      const { ok, data } = await getWithRetry(apiGet, wsEndpoint(workspace, endpoint));
      if (!ok) { errorRef.value = "Failed to fetch"; return; }
      if (data.status !== "ok") { errorRef.value = data.message || "Failed to fetch"; return; }
      const result = (data.data || []).map(mapper);
      listRef.value = result;
      setCountCache(workspace, countKey, result.length);
    } catch (e) {
      errorRef.value = e instanceof Error ? e.message : String(e);
    } finally {
      loadingRef.value = false;
    }
  }

  function _makeLoader(endpoint: string, countKey: string, mapper: (item: any) => any) {
    return (listRef: Ref<any[]>, loadingRef: Ref<boolean>, errorRef: Ref<string>) =>
      _loadList(endpoint, countKey, mapper, listRef, loadingRef, errorRef);
  }

  const loadIssues = _makeLoader("github/issues", "issues", (item) => ({
    number: item.number,
    title: item.title,
    author: item.author?.login || "",
    labels: item.labels || [],
  }));

  const loadPRs = _makeLoader("github/pulls", "prs", mapGitHubPR);

  const loadActions = _makeLoader("github/runs", "actions", mapGitHubRun);

  return { githubUrl, repoName, loadWorkspaceGitHubUrl, loadIssues, loadPRs, loadActions };
}
