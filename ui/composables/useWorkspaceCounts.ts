import { ref, computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { getCachedCount, useGitHub } from "./useGitHub.ts";
import { getStashCachedCount, setStashCache } from "./useStashCache.ts";

/**
 * ワークスペース詳細のタブに表示するバッジ件数（changes / stash / branch /
 * issues / PRs）の保持とロードをまとめる composable。WorkspaceDetail から
 * 件数管理の責務を切り出したもの。
 */
export function useWorkspaceCounts() {
  const workspaceStore = useWorkspaceStore();
  // apiGet の opts は useApi 側が省略可能として扱うため、型上も省略可にする。
  const { apiGet, wsEndpoint }: {
    apiGet: (endpoint: string, opts?: { errorMessage?: string }) => Promise<{ ok: boolean, data: any }>,
    wsEndpoint: (workspace: string, path: string) => string,
  } = useApi();
  const { loadWorkspaceGitHubUrl, loadIssues, loadPRs } = useGitHub();

  const issuesCount = ref<number | null>(null);
  const prsCount = ref<number | null>(null);
  const stashCount = ref<number | null>(null);
  const branchCount = ref<number | null>(null);

  const changesCount = computed(() => {
    const ws = workspaceStore.currentWorkspace;
    if (!ws || ws.clean !== false) return 0;
    return ws.changed_files || 0;
  });

  const hasGitHub = computed(() => !!workspaceStore.currentWorkspace?.github_url);

  /** キャッシュ済みの件数で即座に初期表示する。 */
  function primeFromCache(workspace: string) {
    issuesCount.value = getCachedCount(workspace, "issues");
    prsCount.value = getCachedCount(workspace, "prs");
    stashCount.value = getStashCachedCount(workspace);
  }

  /** stash / branch / GitHub の件数をバックグラウンドで取得する。 */
  async function loadCounts(workspace: string) {
    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "stash-list"));
      if (ok) {
        const entries = data.entries || [];
        stashCount.value = entries.length;
        setStashCache(workspace, entries);
      }
    } catch {}

    try {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "branches"));
      if (ok) branchCount.value = (data || []).filter((b) => !b.remote).length;
    } catch {}

    if (!hasGitHub.value) return;
    loadWorkspaceGitHubUrl();
    const issueItems = ref([]), issueLoading = ref(false), issueError = ref("");
    const prItems = ref([]), prLoading = ref(false), prError = ref("");
    await Promise.all([
      loadIssues(issueItems, issueLoading, issueError),
      loadPRs(prItems, prLoading, prError),
    ]);
    if (!issueError.value) issuesCount.value = issueItems.value.length;
    if (!prError.value) prsCount.value = prItems.value.length;
  }

  return {
    issuesCount,
    prsCount,
    stashCount,
    branchCount,
    changesCount,
    hasGitHub,
    primeFromCache,
    loadCounts,
  };
}
