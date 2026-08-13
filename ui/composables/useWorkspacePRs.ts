import { createWorkspaceResourcePoll } from "./useWorkspaceResourcePoll.ts";
import { mapGitHubPR } from "../utils/github-runs.ts";

// GitHub PRピル用。取得・重複排除・参照カウント式ポーリングの実装は
// useWorkspaceResourcePoll.ts に、レスポンスの整形は utils/github-runs.ts の
// mapGitHubPR に共通化してある（useGitHub の PRペインと同じ形）。

const usePoll = createWorkspaceResourcePoll({ resourcePath: "github/pulls", mapItem: mapGitHubPR });

export function useWorkspacePRs() {
  const { itemsByWorkspace, fetchItems, startPolling, stopPolling } = usePoll();
  return { prsByWorkspace: itemsByWorkspace, fetchPRs: fetchItems, startPolling, stopPolling };
}
