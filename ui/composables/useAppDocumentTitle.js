import { computed, watch } from "vue";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { tabTitleLabel } from "../utils/tab-label.ts";

const APP_NAME = "any-console";

/**
 * App.vue のルートで呼び出し、アクティブタブに応じて document.title を同期する。
 * - 表示中のタブが無ければアプリ名のみ
 * - タブがあれば「APP_NAME - workspace | branch | job」形式
 */
export function useAppDocumentTitle() {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();

  const activeTabLabel = computed(() => {
    if (!terminalStore.openTabs.length) return "";
    const tab = terminalStore.openTabs.find((t) => t.id === terminalStore.activeTabId);
    return tabTitleLabel(tab, workspaceStore.allWorkspaces);
  });

  watch(activeTabLabel, (label) => {
    document.title = label ? `${APP_NAME} - ${label}` : APP_NAME;
  }, { immediate: true });

  return { activeTabLabel };
}
