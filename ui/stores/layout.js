import { defineStore } from "pinia";
import { ref } from "vue";
import { MOBILE_BREAKPOINT_PX } from "../utils/constants.js";
import { isEmptyPaneId, makeEmptyPaneId, countRealPanes } from "../utils/empty-pane.js";

export const useLayoutStore = defineStore("layout", () => {
  const isTouchDevice = !window.matchMedia("(pointer: fine)").matches && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  const panelBottomMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
  const isPanelBottom = ref(panelBottomMediaQuery.matches);
  panelBottomMediaQuery.addEventListener("change", (e) => {
    isPanelBottom.value = e.matches;
  });
  const isPwa = window.matchMedia("(display-mode: standalone)").matches
    || /** @type {any} */ (navigator).standalone === true;

  const isSplitMode = ref(false);
  const splitPaneTabIds = ref([]);
  const activePaneIndex = ref(0);
  const splitLayout = ref("grid");
  const isPaneSelectedByTap = ref(false);

  const isShowDropZones = ref(false);
  const dragTabId = ref(null);

  let emptyPaneSeq = 0;
  function nextEmptyId() {
    emptyPaneSeq += 1;
    return makeEmptyPaneId(emptyPaneSeq);
  }

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

  function splitWithDrop(tabId, direction, openTabs, _activeTabId) {
    if (!tabId) return;

    if (direction === "center") {
      if (isSplitMode.value) exitSplitMode(tabId);
      return;
    }

    if (["top-left", "top-right", "bottom-left", "bottom-right"].includes(direction)) {
      if (isSplitMode.value) {
        const ids = splitPaneTabIds.value.slice();
        const cur = ids.indexOf(tabId);
        if (cur === -1) return;
        const targetIdx = Math.min(cornerToGridIndex(ids.length, direction), ids.length - 1);
        if (cur === targetIdx) return;
        [ids[cur], ids[targetIdx]] = [ids[targetIdx], ids[cur]];
        splitLayout.value = "grid";
        splitPaneTabIds.value = ids;
        activePaneIndex.value = ids.indexOf(tabId);
        return;
      }
      const paneCount = Math.max(4, Math.min(4, openTabs.length || 4));
      const ids = buildPanesWithTabAt(tabId, paneCount, cornerToGridIndex(paneCount, direction));
      splitLayout.value = "grid";
      splitPaneTabIds.value = ids;
      activePaneIndex.value = ids.indexOf(tabId);
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

    const wantFirst = direction === "left" || direction === "top";
    const ids = wantFirst ? [tabId, nextEmptyId()] : [nextEmptyId(), tabId];
    splitLayout.value = newLayout;
    splitPaneTabIds.value = ids;
    activePaneIndex.value = ids.indexOf(tabId);
    isSplitMode.value = true;
  }

  function buildPanesWithTabAt(tabId, paneCount, targetIdx) {
    const arr = new Array(paneCount).fill(null).map(() => nextEmptyId());
    const idx = Math.min(Math.max(0, targetIdx), paneCount - 1);
    arr[idx] = tabId;
    return arr;
  }

  /**
   * 指定ペインに既存タブを割り当てる。
   * そのタブが別ペインで表示中なら、元のペインを空きに置き換える（座席交換）。
   */
  function assignTabToPane(paneIndex, tabId) {
    if (paneIndex < 0 || paneIndex >= splitPaneTabIds.value.length) return;
    const ids = splitPaneTabIds.value.slice();
    const existingIdx = ids.indexOf(tabId);
    if (existingIdx === paneIndex) return;
    if (existingIdx >= 0) {
      ids[existingIdx] = nextEmptyId();
    }
    ids[paneIndex] = tabId;
    splitPaneTabIds.value = ids;
    activePaneIndex.value = paneIndex;
  }

  /**
   * 指定タブIDをペイン配列から空きペインに置き換える。
   * 有効ペインが0個になったら分割を解除する。
   */
  function replaceTabWithEmpty(tabId) {
    if (!isSplitMode.value) return;
    const ids = splitPaneTabIds.value.map((id) => (id === tabId ? nextEmptyId() : id));
    if (countRealPanes(ids) === 0) {
      exitSplitMode();
      return;
    }
    splitPaneTabIds.value = ids;
  }

  function exitSplitMode(targetTabId) {
    const restoreTabId = targetTabId || null;
    isSplitMode.value = false;
    splitPaneTabIds.value = [];
    activePaneIndex.value = 0;
    return restoreTabId;
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
    assignTabToPane,
    replaceTabWithEmpty,
    isEmptyPaneId,
    countRealPanes,
  };
});
