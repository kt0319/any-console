import { useWorkspaceStore } from "../stores/workspace.js";
import { useApi } from "./useApi.js";
import { emit } from "../app-bridge.js";
import { GITHUB_ACTIONS_POLL_MS } from "../utils/constants.js";

export function useGitHubActionsMonitor() {
  const wsStore = useWorkspaceStore();
  const { apiGet, wsEndpoint } = useApi();

  // Map<workspaceName, Map<databaseId, conclusion>>
  const seenRuns = new Map();
  let timer = null;

  async function pollWorkspace(wsName) {
    const { ok, data } = await apiGet(wsEndpoint(wsName, "github/runs"));
    if (!ok || data?.status !== "ok" || !Array.isArray(data?.data)) return;

    const runs = data.data;

    if (!seenRuns.has(wsName)) {
      seenRuns.set(wsName, new Map(runs.map((r) => [r.databaseId, r.conclusion])));
      return;
    }

    const state = seenRuns.get(wsName);
    for (const run of runs) {
      const prev = state.get(run.databaseId);
      const isFailed = run.conclusion === "failure" || run.conclusion === "cancelled";
      const wasNotFailed = prev == null || (prev !== "failure" && prev !== "cancelled");
      if (isFailed && wasNotFailed) {
        const label = run.workflowName || run.displayTitle || "Workflow";
        const status = run.conclusion === "failure" ? "failed" : "cancelled";
        emit("toast:show", {
          message: `[${wsName}] "${label}" ${status}`,
          type: "error",
          duration: 8000,
        });
      }
      state.set(run.databaseId, run.conclusion);
    }
  }

  async function poll() {
    for (const ws of wsStore.visibleWorkspaces) {
      await pollWorkspace(ws.name);
    }
  }

  function start() {
    poll();
    timer = setInterval(poll, GITHUB_ACTIONS_POLL_MS);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop };
}
