import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { MOBILE_BREAKPOINT_PX, LS_KEY_SESSION_SIDEBAR_OPEN, LS_KEY_SESSION_SIDEBAR_WIDTH, SESSION_SIDEBAR_DEFAULT_WIDTH_PX } from "../utils/constants.ts";
import { clampSidebarWidth } from "../utils/sidebar-width.ts";
import { isEmptyPaneId, makeEmptyPaneId, countRealPanes } from "../utils/empty-pane.ts";
import { buildPanesWithTabAt, cornerToGridIndex, resolveExitRestoreTab, soleRemainingTab } from "../utils/split-panes.ts";
import { isTouchInput } from "../utils/device.ts";
import { safeFlagLoad, safeFlagSave, safeJsonLoad, safeJsonSave } from "../utils/storage.ts";
import { resolveTabPosition, resolveKeyboardBarVisible, resolveKeyboardBarFullWidth, resolveTitleBarPosition, resolveInfoPillDisplayMode, isInfoPillBarMode } from "../utils/layout-prefs.ts";
import { useLayoutPrefs } from "../composables/useLayoutPrefs.ts";
import { useTerminalStore } from "./terminal.ts";
import type { TerminalTab } from "./terminal.ts";

export const useLayoutStore = defineStore("layout", () => {
  const isTouchDevice = isTouchInput();
  // 画面幅の生判定。タブバー位置・Keyboard bar表示はlayoutPrefsと合わせて導出する。
  const narrowViewportMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
  const isNarrowViewport = ref(narrowViewportMediaQuery.matches);
  narrowViewportMediaQuery.addEventListener("change", (e) => {
    isNarrowViewport.value = e.matches;
  });
  const layoutPrefs = useLayoutPrefs();
  const isTabBarAtBottom = computed({
    get: () => resolveTabPosition(layoutPrefs.value, isNarrowViewport.value) === "bottom",
    // isNarrowViewportへの代入でレイアウトを直接切替える（layoutPrefsは変更しない）。
    set: (v) => { isNarrowViewport.value = v; },
  });
  const keyboardBarVisible = computed(() => resolveKeyboardBarVisible(layoutPrefs.value, isNarrowViewport.value));
  const keyboardBarFullWidth = computed(() => resolveKeyboardBarFullWidth(layoutPrefs.value, isNarrowViewport.value));
  const infoPillDisplayMode = computed(() => resolveInfoPillDisplayMode(layoutPrefs.value, isNarrowViewport.value));
  const isInfoPillBar = computed(() => isInfoPillBarMode(infoPillDisplayMode.value));
  const titleBarPosition = computed(() => resolveTitleBarPosition(layoutPrefs.value, isNarrowViewport.value));
  const titleBarVisible = computed(() => titleBarPosition.value !== "off");
  const titleBarAtBottom = computed(() => titleBarPosition.value === "bottom");
  const isPwa = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;

  const isAnyOverlayOpen = ref(false);

  // モバイル入力バーのフォーカス中＝OSキーボード表示中。
  const isOsKeyboardOpen = ref(false);

  // 開閉状態と幅はlocalStorageに保存しリロード後も復元する。
  const sessionSidebarWidth = ref(clampSidebarWidth(safeJsonLoad(
    LS_KEY_SESSION_SIDEBAR_WIDTH, SESSION_SIDEBAR_DEFAULT_WIDTH_PX,
  )));
  watch(sessionSidebarWidth, (width) => safeJsonSave(LS_KEY_SESSION_SIDEBAR_WIDTH, width));
  const isSessionSidebarOpen = ref(safeFlagLoad(LS_KEY_SESSION_SIDEBAR_OPEN));
  watch(isSessionSidebarOpen, (v) => {
    safeFlagSave(LS_KEY_SESSION_SIDEBAR_OPEN, v);
  });

  function toggleSessionSidebar() {
    isSessionSidebarOpen.value = !isSessionSidebarOpen.value;
  }

  function closeSessionSidebar() {
    isSessionSidebarOpen.value = false;
  }

  const isSplitMode = ref(false);
  const splitPaneTabIds = ref<(number | string)[]>([]);
  const activePaneIndex = ref(0);
  const splitLayout = ref("grid");

  const isShowDropZones = ref(false);
  const dragTabId = ref<number | null>(null);
  // タッチドラッグ中、指下のタブに対する挿入インジケータ（別コンポーネントインスタンス間で共有するため store 経由）
  const dragOverTabId = ref<number | null>(null);
  const dragOverSide = ref("");

  let emptyPaneSeq = 0;
  function nextEmptyId() {
    emptyPaneSeq += 1;
    return makeEmptyPaneId(emptyPaneSeq);
  }

  function splitWithDrop(tabId: number, direction: string, openTabs: TerminalTab[], _activeTabId?: number | null) {
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
      const ids = buildPanesWithTabAt(tabId, paneCount, cornerToGridIndex(paneCount, direction), nextEmptyId);
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
      const positionUnchanged = (wantFirst && currentIdx === 0) || (!wantFirst && currentIdx === splitPaneTabIds.value.length - 1);
      // 並び順だけでなく軸（vertical/horizontal）も変わらない時だけ何もしない。
      // 軸が変わる場合は並び順が同じでも splitLayout を更新する必要がある。
      if (positionUnchanged && splitLayout.value === newLayout) return;
      const others = splitPaneTabIds.value.filter((id) => id !== tabId);
      splitLayout.value = newLayout;
      splitPaneTabIds.value = wantFirst ? [tabId, ...others] : [...others, tabId];
      activePaneIndex.value = splitPaneTabIds.value.indexOf(tabId);
      return;
    }

    const wantFirst = direction === "left" || direction === "top";
    const sole = soleRemainingTab(openTabs, [tabId]);
    const other = sole ? sole.id : nextEmptyId();
    const ids = wantFirst ? [tabId, other] : [other, tabId];
    splitLayout.value = newLayout;
    splitPaneTabIds.value = ids;
    activePaneIndex.value = ids.indexOf(tabId);
    isSplitMode.value = true;
  }

  /** 指定ペインに既存タブを割り当てる。別ペインで表示中なら元のペインは空きにする（座席交換）。 */
  function assignTabToPane(paneIndex: number, tabId: number) {
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

  /** 指定タブIDをペイン配列から空きペインに置き換える。有効ペインが0個になったら分割を解除する。 */
  function replaceTabWithEmpty(tabId: number) {
    if (!isSplitMode.value) return;
    const ids = splitPaneTabIds.value.map((id) => (id === tabId ? nextEmptyId() : id));
    // exitSplitModeはsplitPaneTabIdsから復帰先を探すため、外したtabId自身が候補に拾われないよう先に反映する。
    splitPaneTabIds.value = ids;
    if (countRealPanes(ids) === 0) {
      exitSplitMode();
    }
  }

  /** 分割を解除し、必ず有効なタブをアクティブにする（switchTabの別途呼び出し不要）。targetTabId未指定時はアクティブペインの実タブ→最初の実タブ。 */
  function exitSplitMode(targetTabId?: number | null): number | null {
    const restoreTabId = resolveExitRestoreTab(splitPaneTabIds.value, activePaneIndex.value, targetTabId);
    isSplitMode.value = false;
    splitPaneTabIds.value = [];
    activePaneIndex.value = 0;
    if (restoreTabId != null) {
      useTerminalStore().switchTab(restoreTabId);
    }
    return restoreTabId;
  }

  /** 指定インデックスの空きペインの隣に空きペインを追加する。開いているタブ数を超えると埋められないため上限とする。 */
  function addPane(paneIndex: number) {
    if (!isSplitMode.value) return;
    if (paneIndex < 0 || paneIndex >= splitPaneTabIds.value.length) return;
    const terminalStore = useTerminalStore();
    if (splitPaneTabIds.value.length >= terminalStore.openTabs.length) return;
    const ids = splitPaneTabIds.value.slice();
    const occupied = ids.filter((id) => !isEmptyPaneId(id));
    const sole = soleRemainingTab(terminalStore.openTabs, occupied);
    ids.splice(paneIndex + 1, 0, sole ? sole.id : nextEmptyId());
    splitPaneTabIds.value = ids;
    activePaneIndex.value = paneIndex + 1;
    if (sole) terminalStore.switchTab(sole.id);
  }

  /**
   * 指定インデックスの空きペインを削除する。残りが1つになったら分割を解除し、実タブなら切替先として返す。
   * @returns 切替先タブID（分割解除時のみ）
   */
  function removeEmptyPane(paneIndex: number): number | null {
    if (!isSplitMode.value) return null;
    if (paneIndex < 0 || paneIndex >= splitPaneTabIds.value.length) return null;
    const ids = splitPaneTabIds.value.slice();
    ids.splice(paneIndex, 1);
    if (ids.length <= 1) {
      const remaining = ids[0];
      const targetTabId = typeof remaining === "number" ? remaining : null;
      exitSplitMode(targetTabId);
      return targetTabId;
    }
    splitPaneTabIds.value = ids;
    if (activePaneIndex.value >= ids.length) {
      activePaneIndex.value = ids.length - 1;
    }
    return null;
  }

  return {
    isTabBarAtBottom,
    isNarrowViewport,
    keyboardBarVisible,
    keyboardBarFullWidth,
    infoPillDisplayMode,
    isInfoPillBar,
    titleBarVisible,
    titleBarAtBottom,
    isTouchDevice,
    isPwa,
    isAnyOverlayOpen,
    isOsKeyboardOpen,
    sessionSidebarWidth,
    isSessionSidebarOpen,
    toggleSessionSidebar,
    closeSessionSidebar,
    isSplitMode,
    splitPaneTabIds,
    activePaneIndex,
    splitLayout,
    isShowDropZones,
    dragTabId,
    dragOverTabId,
    dragOverSide,
    splitWithDrop,
    exitSplitMode,
    assignTabToPane,
    replaceTabWithEmpty,
    addPane,
    removeEmptyPane,
  };
});
