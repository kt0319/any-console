import { onMounted, onBeforeUnmount } from "vue";
import { useConnectivityMonitor } from "./useConnectivityMonitor.ts";

/**
 * App.vue のルートで呼び出し、オンライン/オフライン監視を配線する。
 * - window の online / offline イベント購読
 * - PWA の前面復帰（visibilitychange）で即時に接続を確認
 * - 接続確認 ping の開始 / 停止
 */
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
