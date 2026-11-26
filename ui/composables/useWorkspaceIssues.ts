import { createWorkspaceResourcePoll } from "./useWorkspaceResourcePoll.ts";
import { mapIssue } from "./useGitHub.ts";

// state 未指定はサーバ側既定の open のみ（server/src/github.rs 参照）

const usePoll = createWorkspaceResourcePoll({ resourcePath: "github/issues", mapItem: mapIssue });

export function useWorkspaceIssues() {
  const { itemsByWorkspace, fetchItems, startPolling, stopPolling } = usePoll();
  return { issuesByWorkspace: itemsByWorkspace, fetchIssues: fetchItems, startPolling, stopPolling };
}
