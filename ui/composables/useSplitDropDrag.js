import { useLayoutStore } from "../stores/layout.js";

const DROP_ZONE_CLASS_RE = /\bdrop-(top-left|top-right|bottom-left|bottom-right|left|right|top|bottom|center)\b/;

export function useSplitDropDrag() {
  const layoutStore = useLayoutStore();

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

  function finishSplitDrop({ tabId, clientX, clientY, openTabs, activeTabId }) {
    const dropDir = detectDropZone(clientX, clientY);
    layoutStore.isShowDropZones = false;
    layoutStore.dragTabId = null;
    clearHover();
    if (dropDir) {
      layoutStore.splitWithDrop(tabId, dropDir, openTabs, activeTabId);
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
    finishSplitDrop,
    cancelDrag,
    clearHover,
  };
}
