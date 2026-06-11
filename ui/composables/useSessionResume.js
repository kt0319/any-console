import { onMounted, onBeforeUnmount } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useTerminal } from "./useTerminal.js";
import { useSessionSync } from "./useSessionSync.js";

export function useSessionResume({ terminalBaseView }) {
  const terminalStore = useTerminalStore();
  const { connectTerminalWs } = useTerminal();
  const { syncSessionsFromServer, startSyncPolling, stopSyncPolling } = useSessionSync();

  let resumeDebounceTimer = null;
  let wasHidden = false;

  function scheduleResume() {
    if (document.hidden) return;
    if (resumeDebounceTimer) return;
    resumeDebounceTimer = setTimeout(() => {
      resumeDebounceTimer = null;
      handleResume();
    }, 100);
  }

  function handleResume() {
    for (const tab of terminalStore.openTabs) {
      // 中断中に予約された再接続タイマーは WS の有無に関わらず必ず破棄する。
      // 残すと復帰時の再接続と並走して同じタブに WS が二重接続され表示が崩れる。
      if (tab._reconnectTimer) {
        clearTimeout(tab._reconnectTimer);
        tab._reconnectTimer = null;
      }
      if (tab.ws) {
        try { tab.ws.onclose = null; tab.ws.close(); } catch {}
        tab.ws = null;
      }
      tab._pendingRedraw = true;
      tab._reconnectAttempts = 0;
      terminalStore.setTabFlag(tab.id, "reconnecting", true);
    }

    syncSessionsFromServer().then(() => {
      for (const tab of terminalStore.openTabs) {
        if (tab._pendingRedraw && !tab.ws && !tab._wsDisposed) {
          connectTerminalWs(tab, { focus: false });
        }
      }
      terminalBaseView.value?.fitAllTerminals();
      startSyncPolling();
    });
  }

  function onVisibilityChange() {
    if (document.hidden) {
      wasHidden = true;
      stopSyncPolling();
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;
    scheduleResume();
  }

  function onPageShow(e) {
    if (!e.persisted) return;
    wasHidden = false;
    scheduleResume();
  }

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pageshow", onPageShow);
    if (resumeDebounceTimer) {
      clearTimeout(resumeDebounceTimer);
      resumeDebounceTimer = null;
    }
  });
}
