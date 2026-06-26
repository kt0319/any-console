import { computed, watch } from "vue";
import { useTerminalStore } from "../stores/terminal.js";

const APP_NAME = "any-console";

/**
 * App.vue のルートで呼び出し、アクティブタブに応じて document.title を同期する。
 * - 表示中のタブが無ければアプリ名のみ
 * - タブがあれば「APP_NAME - workspace / job」形式
 */
export function useAppDocumentTitle() {
  const terminalStore = useTerminalStore();

  const activeTabLabel = computed(() => {
    if (!terminalStore.openTabs.length) return "";
    const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
    if (!tab) return "";
    const ws = tab.workspace || "";
    const job = tab.jobLabel || tab.jobName || "";
    return [ws, job].filter(Boolean).join(" / ");
  });

  watch(activeTabLabel, (label) => {
    document.title = label ? `${APP_NAME} - ${label}` : APP_NAME;
  }, { immediate: true });

  return { activeTabLabel };
}
