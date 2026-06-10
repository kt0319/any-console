import { onMounted, onBeforeUnmount } from "vue";
import { useConnectivityMonitor } from "./useConnectivityMonitor.js";

/**
 * App.vue のルートで呼び出し、オンライン/オフライン監視を配線する。
 * - window の online / offline イベント購読
 * - 接続確認 ping の開始 / 停止
 */
export function useAppConnectivity() {
  const { isOffline, startPing, stopPing, onOnline, onOffline } = useConnectivityMonitor();

  onMounted(() => {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    startPing();
  });

  onBeforeUnmount(() => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    stopPing();
  });

  return { isOffline };
}
