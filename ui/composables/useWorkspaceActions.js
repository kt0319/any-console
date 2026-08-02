import { ref } from "vue";
import { useApi } from "./useApi.js";

// 複数のTerminalPaneが同じワークスペースを開いている場合の重複リクエストを
// まとめる（useWorkspacePRs.js と同じパターン）。
const runsByWorkspace = ref(/** @type {Record<string, {id: number|string, name: string, status: string, conclusion: string, headBranch: string, url: string}[]>} */ ({}));
const inFlight = new Map();

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

export function useWorkspaceActions() {
  const { apiGet, wsEndpoint } = useApi();

  async function fetchRuns(workspace) {
    if (!workspace) return [];
    if (inFlight.has(workspace)) return inFlight.get(workspace);
    const promise = (async () => {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "github/runs"));
      const items = ok && data?.status === "ok" && Array.isArray(data.data) ? data.data.map(mapRun) : [];
      runsByWorkspace.value = { ...runsByWorkspace.value, [workspace]: items };
      return items;
    })().finally(() => {
      inFlight.delete(workspace);
    });
    inFlight.set(workspace, promise);
    return promise;
  }

  return { runsByWorkspace, fetchRuns };
}
