import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { EP_PREVIEW_PORTS } from "../utils/endpoints.ts";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.ts";

// TerminalPane は開いているタブごとにマウントされ、非アクティブ分も v-show で
// マウントされたまま残る。各ペインが個別にポーリングすると開いているタブ数だけ
// /preview/ports への重複リクエストが同時に飛んでしまうため、参照カウント付きの
// 単一タイマーに集約し、結果は全ペインで共有する。
const ports = ref<Record<string, any>[]>([]);
let timer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;
// 複数ペインが同時に fetchPorts() を呼ぶと（ワークスペース紐付け直後の
// 一斉リフレッシュ等）、/preview/ports への重複リクエストが同時に飛び、
// サーバ側の preview.scan_once() も呼び出し回数ぶん重複実行されてしまう。
// 実行中の fetch があればそれを返し、新規リクエストを発行しないようにする。
let inFlight: Promise<void> | null = null;

export function usePreviewPorts() {
  const { apiGet } = useApi() as {
    apiGet: (endpoint: string, opts?: { errorMessage?: string }) => Promise<{ ok: boolean, data: any }>,
  };

  async function fetchPorts() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const { ok, data } = await apiGet(EP_PREVIEW_PORTS);
      if (ok && Array.isArray(data)) ports.value = data;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function start() {
    refCount += 1;
    if (refCount > 1) return;
    fetchPorts();
    timer = setInterval(() => {
      if (document.hidden) return;
      fetchPorts();
    }, DEV_SERVER_POLL_INTERVAL_MS);
  }

  function stop() {
    refCount = Math.max(0, refCount - 1);
    if (refCount > 0 || !timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { ports, start, stop, fetchPorts };
}
