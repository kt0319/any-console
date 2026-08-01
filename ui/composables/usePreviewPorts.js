import { ref } from "vue";
import { useApi } from "./useApi.js";
import { EP_PREVIEW_PORTS } from "../utils/endpoints.js";
import { DEV_SERVER_POLL_INTERVAL_MS } from "../utils/constants.js";

// TerminalPane は開いているタブごとにマウントされ、非アクティブ分も v-show で
// マウントされたまま残る。各ペインが個別にポーリングすると開いているタブ数だけ
// /preview/ports への重複リクエストが同時に飛んでしまうため、参照カウント付きの
// 単一タイマーに集約し、結果は全ペインで共有する。
const ports = ref(/** @type {Record<string, any>[]} */ ([]));
let timer = null;
let refCount = 0;

export function usePreviewPorts() {
  const { apiGet } = useApi();

  async function fetchPorts() {
    const { ok, data } = await apiGet(EP_PREVIEW_PORTS);
    if (ok && Array.isArray(data)) ports.value = data;
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
