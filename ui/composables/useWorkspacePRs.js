import { ref } from "vue";
import { useApi } from "./useApi.js";

// 複数のTerminalPaneが同じワークスペースを開いている場合、それぞれが
// 独立にfetchすると /workspaces/{name}/github/pulls への重複リクエストが
// 同時に飛ぶ（usePreviewPorts.js と同じ問題）。ワークスペース名ごとに
// 結果と実行中のfetchをモジュールスコープで共有し、同時呼び出しを1本に
// まとめる。
const prsByWorkspace = ref(/** @type {Record<string, {number: number, title: string, headRefName: string}[]>} */ ({}));
const inFlight = new Map();

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

  return { prsByWorkspace, fetchPRs };
}
