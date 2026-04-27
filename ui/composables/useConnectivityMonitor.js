import { ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { EP_AUTH_CHECK } from "../utils/endpoints.js";

const PING_INTERVAL_MS = 3000;
const PING_TIMEOUT_MS = 2000;
const OFFLINE_THRESHOLD = 2;

export function useConnectivityMonitor() {
  const auth = useAuthStore();
  const isOffline = ref(false);
  let pingTimerId = null;
  let consecutiveFailures = 0;

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
        method: "HEAD",
        headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      consecutiveFailures = 0;
      isOffline.value = false;
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
