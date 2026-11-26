import { ref, computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useApi } from "./useApi.ts";
import { getCachedCount, useGitHub } from "./useGitHub.ts";
import { getStashCachedCount, setStashCache } from "./useStashCache.ts";
import { findPRForBranch, findRunForBranch, isNoticeableRun } from "../utils/github-runs.ts";
import { type AsyncState, asyncIdle } from "../utils/async-state.ts";
import { useDockerContainers } from "./useDockerContainers.ts";
import { isDockerContainerActive } from "../utils/docker.ts";

export function useWorkspaceCounts() {
  const workspaceStore = useWorkspaceStore();
  const { apiGet, wsEndpoint } = useApi();
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
  // InfoPillRow の branchPR/branchAction と同じ基準で色を付ける
  const hasBranchPR = computed(() => !!findPRForBranch(prItems.value, currentBranch.value));
  const hasRunningAction = computed(() => isNoticeableRun(findRunForBranch(actionItems.value, currentBranch.value) as { status?: string, conclusion?: string } | null));

  // タブの出現は静的な has_compose_file、hasDocker はアイコン色用のライブ状態。ポーリングはピル側が回しているので共有結果を読むだけ。
  const { containers: dockerContainers } = useDockerContainers();
  const hasDocker = computed(() => {
    const ws = workspaceStore.selectedWorkspace;
    return !!ws && dockerContainers.value.some((c) => c.workspace === ws && isDockerContainerActive(c.state));
  });

  function primeFromCache(workspace: string) {
    issuesCount.value = getCachedCount(workspace, "issues");
    prsCount.value = getCachedCount(workspace, "prs");
    stashCount.value = getStashCachedCount(workspace);
  }

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
    const issueState = ref<AsyncState<any[]>>(asyncIdle());
    const prState = ref<AsyncState<any[]>>(asyncIdle());
    const actionState = ref<AsyncState<any[]>>(asyncIdle());
    await Promise.all([
      loadIssues()(issueState),
      loadPRs(prState),
      loadActions(actionState),
    ]);
    if (issueState.value.status === "ready") issuesCount.value = issueState.value.value.length;
    if (prState.value.status === "ready") { prsCount.value = prState.value.value.length; prItems.value = prState.value.value; }
    if (actionState.value.status === "ready") actionItems.value = actionState.value.value;
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
    hasDocker,
    primeFromCache,
    loadCounts,
  };
}
