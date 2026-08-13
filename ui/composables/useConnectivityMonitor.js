import { ref } from "vue";
import { EP_AUTH_CHECK } from "../utils/endpoints.ts";
import {
  CONNECTIVITY_PING_INTERVAL_MS as PING_INTERVAL_MS,
  CONNECTIVITY_PING_TIMEOUT_MS as PING_TIMEOUT_MS,
  CONNECTIVITY_OFFLINE_THRESHOLD as OFFLINE_THRESHOLD,
  WS_STALE_THRESHOLD_MS,
} from "../utils/constants.ts";
import { emit } from "../app-bridge.js";
import { useTerminalStore } from "../stores/terminal.js";
import { anyTabWsAlive, staleAliveTabs, decideOffline } from "../utils/connectivity.ts";

const isOffline = ref(false);
let pingTimerId = null;
let consecutiveFailures = 0;

export function useConnectivityMonitor() {

  // WS が生存判定を語れない時だけ叩く HTTP フォールバック。到達可否を返す。
  async function probeServer() {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
      try {
        await fetch(EP_AUTH_CHECK, {
          method: "GET",
          credentials: "same-origin",
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(tid);
      }
      return true;
    } catch {
      return false;
    }
  }

  function currentTabs() {
    try {
      return useTerminalStore().openTabs;
    } catch {
      // Pinia 未初期化（起動直後など）は WS 情報なしとして扱う。
      return [];
    }
  }

  async function checkConnectivity() {
    const navigatorOnline = navigator.onLine;
    const now = performance.now();
    const tabs = currentTabs();

    // 半開き接続（open だが keepalive も来ない）を強制的に閉じ、backoff 再接続へ回す。
    // 切断中に tmux 側で進んだ出力を再接続後に取りこぼさないよう、history 復元も予約する。
    // reconnecting フラグは通常 2 回失敗後にしか立たないため、ここで即座に立てて
    // resume 時と同じオーバーレイを出す（検知直後は何も表示されず、再接続に
    // 失敗し続けた場合にリロードするまで気付けなかったため）。
    if (navigatorOnline) {
      const stale = staleAliveTabs(tabs, now, WS_STALE_THRESHOLD_MS);
      if (stale.length) {
        // stale が非空 = currentTabs() が Pinia 初期化済みで tabs を返せている証拠。
        // ここで安全に useTerminalStore() を呼べる。
        const terminalStore = useTerminalStore();
        for (const tab of stale) {
          tab._needsHistoryRestore = true;
          terminalStore.setTabFlag(tab.id, "reconnecting", true);
          terminalStore.setTabFlag(tab.id, "reconnectReason", "stale");
          try { tab.ws?.close(); } catch { /* already closing */ }
        }
      }
    }

    const wsAlive = navigatorOnline && anyTabWsAlive(tabs, now, WS_STALE_THRESHOLD_MS);

    // 生きた WS があれば HTTP は叩かない（常時ポーリングを止め、負荷時の誤検知も消す）。
    let reachable = wsAlive;
    if (navigatorOnline && !wsAlive) {
      reachable = await probeServer();
    }

    if (reachable) {
      consecutiveFailures = 0;
    } else if (navigatorOnline) {
      consecutiveFailures++;
    }

    const wasOffline = isOffline.value;
    isOffline.value = decideOffline({
      navigatorOnline,
      anyWsAlive: wsAlive,
      consecutiveFailures,
      threshold: OFFLINE_THRESHOLD,
    });

    // オフライン→オンライン復帰時、backoff 待ちの WS を即時再接続させる。
    if (wasOffline && !isOffline.value) emit("connectivity:back");
  }

  function startPing() {
    stopPing();
    pingTimerId = setInterval(checkConnectivity, PING_INTERVAL_MS);
  }

  function stopPing() {
    if (pingTimerId != null) {
      clearInterval(pingTimerId);
      pingTimerId = null;
    }
  }

  function onOnline() {
    consecutiveFailures = 0;
    checkConnectivity();
    // ネットワーク復帰時は待ち状態の WS を即座に叩き起こす。
    emit("connectivity:back");
  }
  function onOffline() { isOffline.value = true; }

  return { isOffline, startPing, stopPing, onOnline, onOffline, checkConnectivity };
}
