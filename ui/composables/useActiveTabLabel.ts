import { computed, type Ref } from "vue";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { isEmptyPaneId } from "../utils/empty-pane.ts";
import { tabTitleLabel } from "../utils/tab-label.ts";

/** タイトルバーに出す、アクティブなタブ（分割中はアクティブなペイン）の表示名。 */
export function useActiveTabLabel(isEmptyScreenVisible: Ref<boolean>) {
  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();

  return computed(() => {
    // tab は markRaw のため tab.workspace 単体の変更は追跡されない。Add で
    // ベアターミナルにワークスペースを紐付けた直後もタイトルに反映されるよう、
    // tabWorkspaceVersion を読んで依存に含める。
    terminalStore.tabWorkspaceVersion;
    if (isEmptyScreenVisible.value) return "";
    let tabId = terminalStore.activeTabId;
    if (layoutStore.isSplitMode) {
      const paneId = layoutStore.splitPaneTabIds[layoutStore.activePaneIndex];
      if (paneId != null && !isEmptyPaneId(paneId)) tabId = paneId;
    }
    const tab = terminalStore.openTabs.find((t) => t.id === tabId);
    const label = tabTitleLabel(tab, workspaceStore.allWorkspaces);
    return layoutStore.isSplitMode ? `[split] ${label}` : label;
  });
}
