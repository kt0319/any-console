import { ref, computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { getCachedCount, useGitHub } from "./useGitHub.ts";
import { getStashCachedCount, setStashCache } from "./useStashCache.ts";
import { findPRForBranch, findRunForBranch, isNoticeableRun } from "../utils/github-runs.ts";

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
  const { loadWorkspaceGitHubUrl, loadIssues, loadPRs, loadActions } = useGitHub();

  const issuesCount = ref<number | null>(null);
  const prsCount = ref<number | null>(null);
  const stashCount = ref<number | null>(null);
  const branchCount = ref<number | null>(null);
  const prItems = ref<{ headRefName?: string }[]>([]);
  const actionItems = ref<{ headBranch?: string, status?: string, conclusion?: string }[]>([]);

  const changesCount = computed(() => {
    const ws = workspaceStore.currentWorkspace;
    if (!ws || ws.clean !== false) return 0;
    return ws.changed_files || 0;
  });

  const hasGitHub = computed(() => !!workspaceStore.currentWorkspace?.github_url);

  const currentBranch = computed(() => workspaceStore.currentWorkspace?.branch || "");
  // PR/ActionsタブアイコンはInfoPillRowの branchPR/branchAction と同じ基準
  // （現在のブランチに対応するPR・実行中/失敗中のrunがあるか）で色を付ける。
  const hasBranchPR = computed(() => !!findPRForBranch(prItems.value, currentBranch.value));
  const hasRunningAction = computed(() => isNoticeableRun(findRunForBranch(actionItems.value, currentBranch.value) as { status?: string, conclusion?: string } | null));

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
      if (ok) branchCount.value = (data || []).filter((b: { remote?: boolean }) => !b.remote).length;
    } catch {}

    if (!hasGitHub.value) return;
    loadWorkspaceGitHubUrl();
    const issueItems = ref([]), issueLoading = ref(false), issueError = ref("");
    const prLoadItems = ref([]), prLoading = ref(false), prError = ref("");
    const actionLoadItems = ref([]), actionLoading = ref(false), actionError = ref("");
    await Promise.all([
      loadIssues(issueItems, issueLoading, issueError),
      loadPRs(prLoadItems, prLoading, prError),
      loadActions(actionLoadItems, actionLoading, actionError),
    ]);
    if (!issueError.value) issuesCount.value = issueItems.value.length;
    if (!prError.value) { prsCount.value = prLoadItems.value.length; prItems.value = prLoadItems.value; }
    if (!actionError.value) actionItems.value = actionLoadItems.value;
  }

  return {
    issuesCount,
    prsCount,
    stashCount,
    branchCount,
    changesCount,
    hasGitHub,
    hasBranchPR,
    hasRunningAction,
    primeFromCache,
    loadCounts,
  };
}
