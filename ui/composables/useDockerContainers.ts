import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { EP_DOCKER_CONTAINERS } from "../utils/endpoints.ts";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.ts";

// usePreviewPorts と同じ理由（開いているタブごとの重複ポーリング防止）で
// 参照カウント付きの単一タイマーに集約し、結果は全ペインで共有する。
const containers = ref<Record<string, any>[]>([]);
let timer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;
let inFlight: Promise<void> | null = null;

export function useDockerContainers() {
  const { apiGet } = useApi() as {
    apiGet: (endpoint: string, opts?: { errorMessage?: string }) => Promise<{ ok: boolean, data: any }>,
  };

  async function fetchContainers() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const { ok, data } = await apiGet(EP_DOCKER_CONTAINERS);
      if (ok && Array.isArray(data)) containers.value = data;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function start() {
    refCount += 1;
    if (refCount > 1) return;
    fetchContainers();
    timer = setInterval(() => {
      if (document.hidden) return;
      fetchContainers();
    }, DEV_SERVER_POLL_INTERVAL_MS);
  }

  function stop() {
    refCount = Math.max(0, refCount - 1);
    if (refCount > 0 || !timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { containers, start, stop, fetchContainers };
}
