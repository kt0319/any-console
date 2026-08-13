import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore } from "../stores/terminal.ts";

/**
 * ターミナル分割のドロップゾーン用ハンドラ群。
 * - dragenter/dragleave で .drag-over クラスを切替
 * - drop で splitWithDrop を呼び、center ドロップなら activeTab を切替
 */
export function useTerminalDrop() {
  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();

  function onDragEnter(e) {
    e.currentTarget.classList.add("drag-over");
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove("drag-over");
  }

  function onDrop(e, direction) {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");
    layoutStore.isShowDropZones = false;
    const raw = layoutStore.dragTabId || e.dataTransfer.getData("text/plain");
    const tabId = typeof raw === "string" ? parseInt(raw, 10) : raw;
    if (tabId) {
      layoutStore.splitWithDrop(tabId, direction, terminalStore.openTabs, terminalStore.activeTabId);
      if (direction === "center" && !layoutStore.isSplitMode) {
        terminalStore.switchTab(tabId);
      }
    }
    layoutStore.dragTabId = null;
  }

  return { onDragEnter, onDragLeave, onDrop };
}
