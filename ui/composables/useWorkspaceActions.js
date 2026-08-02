import { ref } from "vue";
import { useApi } from "./useApi.js";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.js";

// 複数のTerminalPaneが同じワークスペースを開いている場合の重複リクエストを
// まとめる（useWorkspacePRs.js と同じパターン）。
const runsByWorkspace = ref(/** @type {Record<string, {id: number|string, name: string, status: string, conclusion: string, headBranch: string, url: string}[]>} */ ({}));
const inFlight = new Map();

// run実行中のステータス変化（in_progress→success/failure）を拾うため、表示中の
// ワークスペースだけ定期的に再取得する。同じワークスペースを複数のペインが
// 開いていてもタイマーは1本にまとめる（usePreviewPorts.js と同じ方針。
// ただしポート一覧と違い取得先がワークスペースごとに異なるため、参照カウントは
// ワークスペース単位で持つ）。
const pollRefCounts = new Map();
let pollTimer = null;

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

  function ensureTimer() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      for (const workspace of pollRefCounts.keys()) fetchRuns(workspace);
    }, DEV_SERVER_POLL_INTERVAL_MS);
  }

  function startPolling(workspace) {
    if (!workspace) return;
    pollRefCounts.set(workspace, (pollRefCounts.get(workspace) || 0) + 1);
    ensureTimer();
  }

  function stopPolling(workspace) {
    if (!workspace) return;
    const count = (pollRefCounts.get(workspace) || 0) - 1;
    if (count > 0) {
      pollRefCounts.set(workspace, count);
    } else {
      pollRefCounts.delete(workspace);
    }
    if (pollRefCounts.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return { runsByWorkspace, fetchRuns, startPolling, stopPolling };
}
