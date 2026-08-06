import { ref } from "vue";
import { useApi } from "./useApi.js";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.js";

// ワークスペース単位の GitHub 系リソース（PR一覧・Actions run一覧）を取得・
// ポーリングする composable の共通実装（useWorkspacePRs / useWorkspaceActions
// から利用）。
//
// - 複数の TerminalPane が同じワークスペースを開いている場合、それぞれが独立に
//   fetch すると同じエンドポイントへの重複リクエストが同時に飛ぶ
//   （usePreviewPorts.js と同じ問題）。ワークスペース名ごとに結果と実行中の
//   fetch をファクトリ内スコープで共有し、同時呼び出しを1本にまとめる。
// - 値の変化をピルに反映するため、表示中のワークスペースだけ定期的に再取得する。
//   同じワークスペースを複数のペインが開いていてもタイマーは1本にまとめる
//   （usePreviewPorts.js と同じ方針。ただしポート一覧と違い取得先がワークスペース
//   ごとに異なるため、参照カウントはワークスペース単位で持つ）。

/**
 * @param {{resourcePath: string, mapItem: (item: Record<string, any>) => Record<string, any>}} options
 * @returns {() => {
 *   itemsByWorkspace: import("vue").Ref<Record<string, Record<string, any>[]>>,
 *   fetchItems: (workspace: string) => Promise<Record<string, any>[]>,
 *   startPolling: (workspace: string) => void,
 *   stopPolling: (workspace: string) => void,
 * }}
 */
export function createWorkspaceResourcePoll({ resourcePath, mapItem }) {
  const itemsByWorkspace = ref(/** @type {Record<string, Record<string, any>[]>} */ ({}));
  const inFlight = new Map();
  const pollRefCounts = new Map();
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;

  return function useWorkspaceResourcePoll() {
    const { apiGet, wsEndpoint } = useApi();

    async function fetchItems(workspace) {
      if (!workspace) return [];
      if (inFlight.has(workspace)) return inFlight.get(workspace);
      const promise = (async () => {
        const { ok, data } = await apiGet(wsEndpoint(workspace, resourcePath));
        if (!ok || data?.status !== "ok" || !Array.isArray(data.data)) {
          // 取得失敗時は既存キャッシュを空配列で潰さない（表示中のピルが
          // 一時的な失敗のたびに消えてしまうのを防ぐ）。失敗は失敗として
          // 呼び出し元に伝え、キャッシュには触れない。
          return itemsByWorkspace.value[workspace] || [];
        }
        const items = data.data.map(mapItem);
        itemsByWorkspace.value = { ...itemsByWorkspace.value, [workspace]: items };
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
        for (const workspace of pollRefCounts.keys()) fetchItems(workspace);
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

    return { itemsByWorkspace, fetchItems, startPolling, stopPolling };
  };
}
