import { ref } from "vue";
import { useApi } from "./useApi.ts";

// サーバ全体で1つのリスト（ポート一覧・Docker コンテナ一覧等）を取得・ポーリングする
// composable の共通実装（usePreviewPorts / useDockerContainers から利用）。
//
// TerminalPane は開いているタブごとにマウントされ、非アクティブ分も v-show で
// マウントされたまま残る。各ペインが個別にポーリングすると開いているタブ数だけ
// 同じエンドポイントへの重複リクエストが同時に飛んでしまうため、参照カウント付きの
// 単一タイマーに集約し、結果は全ペインで共有する。
// 同時の fetchItems() 呼び出し（ワークスペース紐付け直後の一斉リフレッシュ等）も、
// 実行中の fetch を返して1リクエストにまとめる（サーバ側のスキャン重複実行を防ぐ）。
// ワークスペースごとに取得先が変わるリソースは useWorkspaceResourcePoll.ts を使う。

export function createSharedResourcePoll({ endpoint, intervalMs }: {
  endpoint: string,
  intervalMs: number,
}) {
  const items = ref<Record<string, any>[]>([]);
  let timer: ReturnType<typeof setInterval> | null = null;
  let refCount = 0;
  let inFlight: Promise<void> | null = null;

  return function useSharedResourcePoll() {
    const { apiGet } = useApi();
    // 参照カウントへの参加はインスタンスごとに1回だけにする（start/stop を冪等にし、
    // 呼び出し側が「開始済みか」のフラグを持たなくてよいようにする）。
    let participating = false;

    async function fetchItems() {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const { ok, data } = await apiGet(endpoint);
        if (ok && Array.isArray(data)) items.value = data;
      })().finally(() => {
        inFlight = null;
      });
      return inFlight;
    }

    function start() {
      if (participating) return;
      participating = true;
      refCount += 1;
      if (refCount > 1) return;
      fetchItems();
      timer = setInterval(() => {
        if (document.hidden) return;
        fetchItems();
      }, intervalMs);
    }

    function stop() {
      if (!participating) return;
      participating = false;
      refCount -= 1;
      if (refCount > 0 || !timer) return;
      clearInterval(timer);
      timer = null;
    }

    return { items, start, stop, fetchItems };
  };
}
