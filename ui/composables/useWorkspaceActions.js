import { createWorkspaceResourcePoll } from "./useWorkspaceResourcePoll.js";

// GitHub Actionsピル用。取得・重複排除・参照カウント式ポーリングの実装は
// useWorkspaceResourcePoll.js に共通化してある（run実行中のステータス変化
// （in_progress→success/failure）を拾うため、表示中だけ定期的に再取得する）。

function mapRun(item) {
  return {
    id: item.databaseId ?? item.id,
    name: item.displayTitle || item.workflowName || item.name || "",
    status: item.status || "",
    conclusion: item.conclusion || "",
    headBranch: item.headBranch || "",
    url: item.url || "",
  };
}

const usePoll = createWorkspaceResourcePoll({ resourcePath: "github/runs", mapItem: mapRun });

export function useWorkspaceActions() {
  const { itemsByWorkspace, fetchItems, startPolling, stopPolling } = usePoll();
  return { runsByWorkspace: itemsByWorkspace, fetchRuns: fetchItems, startPolling, stopPolling };
}
