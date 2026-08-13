import { ref, computed, watch, nextTick } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import type { TerminalTab } from "../stores/terminal.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { buildGridRows } from "../utils/terminal-layout.ts";
import { isEmptyPaneId } from "../utils/empty-pane.ts";

/**
 * TerminalBase の分割ペイン表示まわりの状態とロジック。
 * - split レイアウト用の computed（コンテナクラス・グリッド行）
 * - ペイン選択とタブ解決
 * - 表示中ペインの fit 一括実行（split 切替時の再 fit を含む）
 */
// TerminalPane.vue が defineExpose する形（tabId / fit のみ利用）。
interface TerminalPaneRef {
  tabId?: number | string;
  fit?: (opts?: { force?: boolean, scrollToBottom?: boolean }) => void;
}

export function useTerminalSplitPanes() {
  const terminalStore = useTerminalStore();
  const layoutStore = useLayoutStore();

  const paneRefs = ref<(TerminalPaneRef | null)[]>([]);

  const openTabs = computed(() => terminalStore.openTabs);
  const activeTabId = computed(() => terminalStore.activeTabId);
  const isSplitMode = computed(() => layoutStore.isSplitMode);
  const splitLayout = computed(() => layoutStore.splitLayout || "horizontal");
  const splitPaneTabIds = computed(() => layoutStore.splitPaneTabIds);
  const activePaneIndex = computed(() => layoutStore.activePaneIndex);
  const isShowDropZones = computed(() => layoutStore.isShowDropZones);

  const splitContainerClasses = computed(() => {
    if (!isSplitMode.value) return {};
    return {
      "split-active": true,
      [`split-${splitLayout.value}`]: true,
      "split-mobile": layoutStore.isPanelBottom,
    };
  });

  const gridRows = computed(() => {
    if (!isSplitMode.value || splitLayout.value !== "grid") return [];
    return buildGridRows(splitPaneTabIds.value);
  });

  function getTabById(tabId: number | string): TerminalTab | { id: number | string, _pendingOpen: boolean } {
    return openTabs.value.find((t) => t.id === tabId) || { id: tabId, _pendingOpen: false };
  }

  function selectPane(index: number) {
    layoutStore.activePaneIndex = index;
    const tabId = layoutStore.splitPaneTabIds[index];
    if (tabId != null && !isEmptyPaneId(tabId)) {
      terminalStore.switchTab(tabId);
    }
  }

  function fitAllTerminals(opts?: { force?: boolean, scrollToBottom?: boolean }) {
    if (!paneRefs.value) return;
    const refs = Array.isArray(paneRefs.value) ? paneRefs.value : [paneRefs.value];
    const visibleTabIds = new Set<number | string | undefined>();
    if (isSplitMode.value) {
      for (const id of splitPaneTabIds.value || []) {
        if (id != null && !isEmptyPaneId(id)) visibleTabIds.add(id);
      }
    } else if (activeTabId.value != null) {
      visibleTabIds.add(activeTabId.value);
    }
    for (const pane of refs) {
      if (!visibleTabIds.has(pane?.tabId)) continue;
      pane?.fit?.(opts);
    }
  }

  watch(isSplitMode, async () => {
    await nextTick();
    requestAnimationFrame(() => fitAllTerminals());
  });

  return {
    paneRefs,
    openTabs,
    activeTabId,
    isSplitMode,
    splitLayout,
    splitPaneTabIds,
    activePaneIndex,
    isShowDropZones,
    splitContainerClasses,
    gridRows,
    getTabById,
    selectPane,
    fitAllTerminals,
  };
}
