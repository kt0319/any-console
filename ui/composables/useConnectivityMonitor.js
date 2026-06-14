import { ref } from "vue";
import { EP_AUTH_CHECK } from "../utils/endpoints.js";
import {
  CONNECTIVITY_PING_INTERVAL_MS as PING_INTERVAL_MS,
  CONNECTIVITY_PING_TIMEOUT_MS as PING_TIMEOUT_MS,
  CONNECTIVITY_OFFLINE_THRESHOLD as OFFLINE_THRESHOLD,
} from "../utils/constants.js";
import { emit } from "../app-bridge.js";

const isOffline = ref(false);
let pingTimerId = null;
let consecutiveFailures = 0;

export function useConnectivityMonitor() {

  async function checkConnectivity() {
    if (!navigator.onLine) {
      consecutiveFailures = OFFLINE_THRESHOLD;
      isOffline.value = true;
      return;
    }
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS);
      await fetch(EP_AUTH_CHECK, {
        method: "GET",
        credentials: "same-origin",
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      const wasFailing = consecutiveFailures > 0;
      consecutiveFailures = 0;
      isOffline.value = false;
      // サーバが復活した瞬間にバックオフ待ちの WS を即時再接続させる。
      // restart 直後の retry 大量化（5秒×N回 待ち）を縮める。
      if (wasFailing) emit("connectivity:back");
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= OFFLINE_THRESHOLD) {
        isOffline.value = true;
      }
    }
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

  function onOnline() { checkConnectivity(); }
  function onOffline() { isOffline.value = true; }

  return { isOffline, startPing, stopPing, onOnline, onOffline };
}
