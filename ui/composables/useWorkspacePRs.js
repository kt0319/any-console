import { ref } from "vue";
import { useApi } from "./useApi.js";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.js";

// 複数のTerminalPaneが同じワークスペースを開いている場合、それぞれが
// 独立にfetchすると /workspaces/{name}/github/pulls への重複リクエストが
// 同時に飛ぶ（usePreviewPorts.js と同じ問題）。ワークスペース名ごとに
// 結果と実行中のfetchをモジュールスコープで共有し、同時呼び出しを1本に
// まとめる。
const prsByWorkspace = ref(/** @type {Record<string, {number: number, title: string, headRefName: string}[]>} */ ({}));
const inFlight = new Map();

// PRの作成・クローズ・タイトル変更をピルに反映するため、表示中のワーク
// スペースだけ定期的に再取得する（useWorkspaceActions.jsと同じ参照カウント
// 式のポーリング）。
const pollRefCounts = new Map();
let pollTimer = null;

function mapPR(item) {
  return {
    number: item.number,
    title: item.title,
    headRefName: item.headRefName || "",
  };
}

export function useWorkspacePRs() {
  const { apiGet, wsEndpoint } = useApi();

  async function fetchPRs(workspace) {
    if (!workspace) return [];
    if (inFlight.has(workspace)) return inFlight.get(workspace);
    const promise = (async () => {
      const { ok, data } = await apiGet(wsEndpoint(workspace, "github/pulls"));
      const items = ok && data?.status === "ok" && Array.isArray(data.data) ? data.data.map(mapPR) : [];
      prsByWorkspace.value = { ...prsByWorkspace.value, [workspace]: items };
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
      for (const workspace of pollRefCounts.keys()) fetchPRs(workspace);
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

  return { prsByWorkspace, fetchPRs, startPolling, stopPolling };
}
