import { onBeforeUnmount, watch, type ComputedRef } from "vue";
import { useWorkspacePRs } from "./useWorkspacePRs.ts";
import { useWorkspaceRuns } from "./useWorkspaceRuns.ts";
import { useWorkspaceIssues } from "./useWorkspaceIssues.ts";
import { unwatchGitHubWorkspace, watchGitHubWorkspace } from "../utils/github-watch.ts";

// PR / Actions / Issues ピルは常にセットで取得・ポーリング・停止するため、3種類をまとめる薄いラッパー。
// TerminalPane.vue と SessionListView.vue が共用する。
export function useGitHubPolling() {
  const { prsByWorkspace, fetchPRs, startPolling: startPRsPolling, stopPolling: stopPRsPolling } = useWorkspacePRs();
  const { runsByWorkspace, fetchRuns, startPolling: startActionsPolling, stopPolling: stopActionsPolling } = useWorkspaceRuns();
  const { issuesByWorkspace, fetchIssues, startPolling: startIssuesPolling, stopPolling: stopIssuesPolling } = useWorkspaceIssues();

  /** 取得してからポーリングを開始する。新着通知はサーバの github_watch へ監視を宣言して受ける。 */
  function startGitHubPolling(workspace: string) {
    watchGitHubWorkspace(workspace);
    fetchPRs(workspace);
    fetchRuns(workspace);
    fetchIssues(workspace);
    startPRsPolling(workspace);
    startActionsPolling(workspace);
    startIssuesPolling(workspace);
  }

  function stopGitHubPolling(workspace: string) {
    unwatchGitHubWorkspace(workspace);
    stopPRsPolling(workspace);
    stopActionsPolling(workspace);
    stopIssuesPolling(workspace);
  }

  return { prsByWorkspace, runsByWorkspace, issuesByWorkspace, startGitHubPolling, stopGitHubPolling };
}

/** 対象ワークスペース集合の変化に追従してポーリングを増減し、アンマウント時にまとめて停止する。 */
export function useGitHubPollingFor(keys: ComputedRef<string[]>) {
  const polling = useGitHubPolling();
  let active: string[] = [];
  watch(keys, (next) => {
    const keySet = new Set(next);
    for (const old of active) {
      if (!keySet.has(old)) polling.stopGitHubPolling(old);
    }
    for (const key of next) {
      if (!active.includes(key)) polling.startGitHubPolling(key);
    }
    active = [...next];
  }, { immediate: true });
  onBeforeUnmount(() => {
    for (const key of active) polling.stopGitHubPolling(key);
    active = [];
  });
  return polling;
}
