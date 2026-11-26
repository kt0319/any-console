import { createWorkspaceResourcePoll } from "./useWorkspaceResourcePoll.ts";
import { mapGitHubRun } from "../utils/github-runs.ts";

const usePoll = createWorkspaceResourcePoll({ resourcePath: "github/runs", mapItem: mapGitHubRun });

export function useWorkspaceRuns() {
  const { itemsByWorkspace, fetchItems, startPolling, stopPolling } = usePoll();
  return { runsByWorkspace: itemsByWorkspace, fetchRuns: fetchItems, startPolling, stopPolling };
}
