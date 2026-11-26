import { createWorkspaceResourcePoll } from "./useWorkspaceResourcePoll.ts";
import { mapGitHubPR } from "../utils/github-runs.ts";

const usePoll = createWorkspaceResourcePoll({ resourcePath: "github/pulls", mapItem: mapGitHubPR });

export function useWorkspacePRs() {
  const { itemsByWorkspace, fetchItems, startPolling, stopPolling } = usePoll();
  return { prsByWorkspace: itemsByWorkspace, fetchPRs: fetchItems, startPolling, stopPolling };
}
