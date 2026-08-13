import { createWorkspaceResourcePoll } from "./useWorkspaceResourcePoll.ts";
import { mapGitHubRun } from "../utils/github-runs.ts";

// GitHub Actionsピル用。取得・重複排除・参照カウント式ポーリングの実装は
// useWorkspaceResourcePoll.ts に、レスポンスの整形は utils/github-runs.ts の
// mapGitHubRun に共通化してある（run実行中のステータス変化
// （in_progress→success/failure）を拾うため、表示中だけ定期的に再取得する）。

const usePoll = createWorkspaceResourcePoll({ resourcePath: "github/runs", mapItem: mapGitHubRun });

export function useWorkspaceRuns() {
  const { itemsByWorkspace, fetchItems, startPolling, stopPolling } = usePoll();
  return { runsByWorkspace: itemsByWorkspace, fetchRuns: fetchItems, startPolling, stopPolling };
}
