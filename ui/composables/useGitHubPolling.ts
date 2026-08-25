import { onBeforeUnmount, watch, type ComputedRef } from "vue";
import { useWorkspacePRs } from "./useWorkspacePRs.ts";
import { useWorkspaceRuns } from "./useWorkspaceRuns.ts";

// GitHub PR / Actions ピルのデータ源はどの利用箇所でも必ずペアで
// 取得・ポーリング開始・停止するため、その4点セットをまとめる薄いラッパー。
// TerminalPane.vue（ワークスペース1つ）と SessionListView.vue（開いている
// タブのワークスペース集合）が共用する。個別の取得・重複排除・参照カウント式
// ポーリングの実装は useWorkspacePRs / useWorkspaceRuns（それぞれ
// useWorkspaceResourcePoll.ts の共通ファクトリ）のまま。
export function useGitHubPolling() {
  const { prsByWorkspace, fetchPRs, startPolling: startPRsPolling, stopPolling: stopPRsPolling } = useWorkspacePRs();
  const { runsByWorkspace, fetchRuns, startPolling: startActionsPolling, stopPolling: stopActionsPolling } = useWorkspaceRuns();

  /** 取得してからポーリングを開始する。 */
  function startGitHubPolling(workspace: string) {
    fetchPRs(workspace);
    fetchRuns(workspace);
    startPRsPolling(workspace);
    startActionsPolling(workspace);
  }

  function stopGitHubPolling(workspace: string) {
    stopPRsPolling(workspace);
    stopActionsPolling(workspace);
  }

  return { prsByWorkspace, runsByWorkspace, startGitHubPolling, stopGitHubPolling };
}

/**
 * 対象ワークスペース集合の変化に追従してポーリングを増減し、アンマウント時に
 * まとめて停止する（TerminalPane = 1件 / SessionListView = 複数件で共用の
 * 差分開始・停止ブックキーピング）。
 */
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
