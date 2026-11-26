import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { GITHUB_POLL_INTERVAL_MS } from "../utils/constants.ts";

// ワークスペース単位の GitHub 系リソース（PR一覧・Actions run一覧）の取得・ポーリング共通実装（useWorkspacePRs / useWorkspaceRuns から利用）。
// 複数ペインが同じワークスペースを開いても、結果・実行中fetch・タイマーはワークスペース単位で共有して1本にまとめる
// （useSharedResourcePoll.ts と同じ方針。取得先がワークスペースごとのため参照カウントもワークスペース単位）。

export function createWorkspaceResourcePoll({ resourcePath, mapItem }: {
  resourcePath: string,
  mapItem: (item: Record<string, any>) => Record<string, any>,
}) {
  const itemsByWorkspace = ref<Record<string, Record<string, any>[]>>({});
  const inFlight = new Map<string, Promise<Record<string, any>[]>>();
  const pollRefCounts = new Map<string, number>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  return function useWorkspaceResourcePoll() {
    const { apiGet, wsEndpoint } = useApi();

    async function fetchItems(workspace: string): Promise<Record<string, any>[]> {
      if (!workspace) return [];
      if (inFlight.has(workspace)) return inFlight.get(workspace)!;
      const promise = (async () => {
        const { ok, data } = await apiGet(wsEndpoint(workspace, resourcePath));
        if (!ok || data?.status !== "ok" || !Array.isArray(data.data)) {
          // 取得失敗時は既存キャッシュを空配列で潰さない（ピルが一時失敗のたびに消えるのを防ぐ）。失敗は呼び出し元へ伝える。
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
      }, GITHUB_POLL_INTERVAL_MS);
    }

    function startPolling(workspace: string) {
      if (!workspace) return;
      pollRefCounts.set(workspace, (pollRefCounts.get(workspace) || 0) + 1);
      ensureTimer();
    }

    function stopPolling(workspace: string) {
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
