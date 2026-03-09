import { defineStore } from "pinia";
import { ref } from "vue";

export const useLayoutStore = defineStore("layout", () => {
  const panelBottomMediaQuery = window.matchMedia("(max-width: 768px) and (orientation: portrait)");
  const isPanelBottom = ref(panelBottomMediaQuery.matches);
  panelBottomMediaQuery.addEventListener("change", (e) => {
    isPanelBottom.value = e.matches;
  });
  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const isPwa = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  const isSplitMode = ref(false);
  const splitPaneTabIds = ref([]);
  const activePaneIndex = ref(0);
  const splitLayout = ref("grid");
  const isPaneSelectedByTap = ref(false);

  const isShowDropZones = ref(false);
  const dragTabId = ref(null);

  function calcGridLayout(count) {
    if (count <= 1) return [1];
    if (count === 2) return [1, 1];
    if (count === 3) return [2, 1];
    if (count === 4) return [2, 2];
    return [3, Math.max(1, count - 3)];
  }

  function cornerToGridIndex(count, corner) {
    const rows = calcGridLayout(count);
    const topCols = rows[0] || 1;
    const bottomRow = rows.length - 1;
    const bottomCols = rows[bottomRow] || 1;
    let rowIdx = 0;
    let colIdx = 0;

    if (corner === "top-right") {
      rowIdx = 0;
      colIdx = Math.max(0, topCols - 1);
    } else if (corner === "bottom-left") {
      rowIdx = bottomRow;
      colIdx = 0;
    } else if (corner === "bottom-right") {
      rowIdx = bottomRow;
      colIdx = Math.max(0, bottomCols - 1);
    }

    let offset = 0;
    for (let i = 0; i < rowIdx; i++) offset += rows[i];
    return offset + colIdx;
  }

  function splitWithDrop(tabId, direction, openTabs, activeTabId) {
    if (!tabId) return;

    if (direction === "center") {
      if (isSplitMode.value) exitSplitMode(tabId);
      return;
    }

    if (["top-left", "top-right", "bottom-left", "bottom-right"].includes(direction)) {
      const ids = openTabs.map((t) => t.id);
      if (!ids.includes(tabId)) return;
      const targetIdx = cornerToGridIndex(ids.length, direction);
      const reordered = ids.filter((id) => id !== tabId);
      reordered.splice(Math.min(Math.max(0, targetIdx), reordered.length), 0, tabId);
      splitLayout.value = "grid";
      splitPaneTabIds.value = reordered;
      activePaneIndex.value = splitPaneTabIds.value.indexOf(tabId);
      isSplitMode.value = true;
      return;
    }

    const newLayout = (direction === "left" || direction === "right") ? "horizontal" : "vertical";

    if (isSplitMode.value) {
      const wantFirst = direction === "left" || direction === "top";
      const currentIdx = splitPaneTabIds.value.indexOf(tabId);
      if ((wantFirst && currentIdx === 0) || (!wantFirst && currentIdx === splitPaneTabIds.value.length - 1)) return;
      const others = splitPaneTabIds.value.filter((id) => id !== tabId);
      splitLayout.value = newLayout;
      splitPaneTabIds.value = wantFirst ? [tabId, ...others] : [...others, tabId];
      activePaneIndex.value = splitPaneTabIds.value.indexOf(tabId);
      return;
    }

    const otherId = activeTabId && activeTabId !== tabId
      ? activeTabId
      : openTabs.find((t) => t.id !== tabId)?.id;
    if (!otherId) return;

    splitLayout.value = newLayout;
    splitPaneTabIds.value = (direction === "left" || direction === "top")
      ? [tabId, otherId]
      : [otherId, tabId];
    activePaneIndex.value = splitPaneTabIds.value.indexOf(tabId);
    isSplitMode.value = true;
  }

  function exitSplitMode(targetTabId) {
    isSplitMode.value = false;
    splitPaneTabIds.value = [];
    activePaneIndex.value = 0;
  }

  return {
    isPanelBottom,
    isTouchDevice,
    isPwa,
    isSplitMode,
    splitPaneTabIds,
    activePaneIndex,
    splitLayout,
    isPaneSelectedByTap,
    isShowDropZones,
    dragTabId,
    splitWithDrop,
    exitSplitMode,
  };
});
