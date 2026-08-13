import { useWorkspacePRs } from "./useWorkspacePRs.ts";
import { useWorkspaceRuns } from "./useWorkspaceRuns.ts";

// GitHub PR / Actions ピルのデータ源はどの利用箇所でも必ずペアで
// 取得・ポーリング開始・停止するため、その4点セットをまとめる薄いラッパー。
// TerminalPane.vue（ワークスペース1つ）と SessionListView.vue（開いている
// タブのワークスペース集合）が共用する。個別の取得・重複排除・参照カウント式
// ポーリングの実装は useWorkspacePRs / useWorkspaceRuns（それぞれ
// useWorkspaceResourcePoll.ts の共通ファクトリ）のまま。
export function useGithubPolling() {
  const { prsByWorkspace, fetchPRs, startPolling: startPRsPolling, stopPolling: stopPRsPolling } = useWorkspacePRs();
  const { runsByWorkspace, fetchRuns, startPolling: startActionsPolling, stopPolling: stopActionsPolling } = useWorkspaceRuns();

  /** 取得してからポーリングを開始する。 */
  function startGithubPolling(workspace: string) {
    fetchPRs(workspace);
    fetchRuns(workspace);
    startPRsPolling(workspace);
    startActionsPolling(workspace);
  }

  function stopGithubPolling(workspace: string) {
    stopPRsPolling(workspace);
    stopActionsPolling(workspace);
  }

  return { prsByWorkspace, runsByWorkspace, startGithubPolling, stopGithubPolling };
}
