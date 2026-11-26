import { onMounted, onBeforeUnmount } from "vue";
import { useConnectivityMonitor } from "./useConnectivityMonitor.ts";

/** App.vue のルートで呼び出し、オンライン/オフライン監視・前面復帰時の接続確認・接続確認 ping を配線する。 */
export function useAppConnectivity() {
  const { isOffline, startPing, stopPing, onOnline, onOffline, checkConnectivity } = useConnectivityMonitor();

  function onVisibilityChange() {
    // バックグラウンド中に切れた WS を前面復帰の瞬間に検知・再接続させる。
    if (document.visibilityState === "visible") checkConnectivity();
  }

  onMounted(() => {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    startPing();
  });

  onBeforeUnmount(() => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stopPing();
  });

  return { isOffline };
}
