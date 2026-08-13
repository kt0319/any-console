import { createWorkspaceResourcePoll } from "./useWorkspaceResourcePoll.ts";

// GitHub PRピル用。取得・重複排除・参照カウント式ポーリングの実装は
// useWorkspaceResourcePoll.js に共通化してある。

function mapPR(item: Record<string, any>) {
  return {
    number: item.number,
    title: item.title,
    headRefName: item.headRefName || "",
  };
}

const usePoll = createWorkspaceResourcePoll({ resourcePath: "github/pulls", mapItem: mapPR });

export function useWorkspacePRs() {
  const { itemsByWorkspace, fetchItems, startPolling, stopPolling } = usePoll();
  return { prsByWorkspace: itemsByWorkspace, fetchPRs: fetchItems, startPolling, stopPolling };
}
