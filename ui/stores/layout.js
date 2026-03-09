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

  function splitWithDrop(tabId, direction, openTabs, activeTabId) {
    if (!tabId) return;

    if (direction === "center") {
      if (isSplitMode.value) exitSplitMode(tabId);
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
    panelBottomMediaQuery,
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
