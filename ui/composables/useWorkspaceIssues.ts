import { createWorkspaceResourcePoll } from "./useWorkspaceResourcePoll.ts";
import { mapIssue } from "./useGitHub.ts";

// Issuesピル用。取得・重複排除・参照カウント式ポーリングの実装は
// useWorkspaceResourcePoll.ts に、レスポンスの整形は useGitHub.ts の
// mapIssue に共通化してある（useWorkspacePRs.ts と同じ形）。
// state未指定はサーバ側既定のopenのみ（server/src/github.rs参照）。

const usePoll = createWorkspaceResourcePoll({ resourcePath: "github/issues", mapItem: mapIssue });

export function useWorkspaceIssues() {
  const { itemsByWorkspace, fetchItems, startPolling, stopPolling } = usePoll();
  return { issuesByWorkspace: itemsByWorkspace, fetchIssues: fetchItems, startPolling, stopPolling };
}
