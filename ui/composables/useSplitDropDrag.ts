import { useLayoutStore } from "../stores/layout.ts";
import { useTerminalStore } from "../stores/terminal.ts";

const DROP_ZONE_CLASS_RE = /\bdrop-(top-left|top-right|bottom-left|bottom-right|left|right|top|bottom|center)\b/;

export function useSplitDropDrag() {
  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();

  function getDropZones() {
    return document.querySelectorAll(".split-drop-zone");
  }

  function clearHover() {
    getDropZones().forEach((zone) => zone.classList.remove("drag-over"));
  }

  function beginDrag(tabId) {
    layoutStore.dragTabId = tabId;
    layoutStore.isShowDropZones = true;
  }

  function updateHover(clientX, clientY) {
    getDropZones().forEach((zone) => {
      const rect = zone.getBoundingClientRect();
      const isInside =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;
      zone.classList.toggle("drag-over", isInside);
    });
  }

  function detectDropZone(clientX, clientY) {
    for (const zone of getDropZones()) {
      const rect = zone.getBoundingClientRect();
      const isInside =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;
      if (!isInside) continue;
      const match = zone.className.match(DROP_ZONE_CLASS_RE);
      return match ? match[1] : null;
    }
    return null;
  }

  /**
   * ドロップ確定の共通処理（ポインタ座標経由の finishSplitDrop と HTML5 DnD
   * 経由の useSplitDropZones.onDrop の両方から呼ぶ）。
   */
  function applySplitDrop(tabId, direction) {
    layoutStore.splitWithDrop(tabId, direction, terminalStore.openTabs, terminalStore.activeTabId);
    if (direction === "center" && !layoutStore.isSplitMode) {
      terminalStore.switchTab(tabId);
    }
  }

  function finishSplitDrop({ tabId, clientX, clientY }) {
    const dropDir = detectDropZone(clientX, clientY);
    layoutStore.isShowDropZones = false;
    layoutStore.dragTabId = null;
    clearHover();
    if (dropDir) {
      applySplitDrop(tabId, dropDir);
    }
    return dropDir;
  }

  function cancelDrag() {
    layoutStore.isShowDropZones = false;
    layoutStore.dragTabId = null;
    clearHover();
  }

  return {
    beginDrag,
    updateHover,
    detectDropZone,
    applySplitDrop,
    finishSplitDrop,
    cancelDrag,
    clearHover,
  };
}
