import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { MOBILE_BREAKPOINT_PX, LS_KEY_SESSION_SIDEBAR_OPEN } from "../utils/constants.ts";
import { isEmptyPaneId, makeEmptyPaneId, countRealPanes, realTabIds } from "../utils/empty-pane.ts";
import { calcGridLayout } from "../utils/terminal-layout.ts";
import { isTouchInput } from "../utils/device.ts";
import { safeFlagLoad, safeFlagSave } from "../utils/storage.ts";
import { useTerminalStore } from "./terminal.ts";
import type { TerminalTab } from "./terminal.ts";

export const useLayoutStore = defineStore("layout", () => {
  const isTouchDevice = isTouchInput();
  const panelBottomMediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
  const isPanelBottom = ref(panelBottomMediaQuery.matches);
  panelBottomMediaQuery.addEventListener("change", (e) => {
    isPanelBottom.value = e.matches;
  });
  const isPwa = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;

  const isSettingsOpen = ref(false);

  // タブバー左端のハンバーガーで開くセッションサイドバー（SessionSidebar.vue）。
  // 開閉状態はlocalStorageへ保存し、リロード後も復元する。
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

  function cornerToGridIndex(count: number, corner: string) {
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

  // 新規に空きペインを作る時、割り当てられる候補タブが1つしか無いなら選ばせる
  // までもないため、そのタブを返す（無ければnull＝これまで通り空きペインにする）。
  // 空きペイン側に一覧を出してからユーザー操作で選ばせる方式（reactiveな
  // watch等）だと、SplitEmptyPane.vue のマイナスボタン（ペインを明示的に
  // 空ける操作）でも「候補が1つだけ」の状態が再現され、外したタブ自身が
  // 即座に再割り当てされて選択画面に戻れなくなる不具合があった。生成時点
  // だけで判定するこの方式ならその副作用が起きない。
  function soleRemainingTab(openTabs: TerminalTab[] | null | undefined, excludeIds: (number | string)[]): TerminalTab | null {
    const exclude = new Set(excludeIds);
    const candidates = (openTabs || []).filter((t) => !exclude.has(t.id));
    return candidates.length === 1 ? candidates[0] : null;
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

  function buildPanesWithTabAt(tabId: number, paneCount: number, targetIdx: number) {
    const arr: (number | string)[] = new Array(paneCount).fill(null).map(() => nextEmptyId());
    const idx = Math.min(Math.max(0, targetIdx), paneCount - 1);
    arr[idx] = tabId;
    return arr;
  }

  /**
   * 指定ペインに既存タブを割り当てる。
   * そのタブが別ペインで表示中なら、元のペインを空きに置き換える（座席交換）。
   */
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

  /**
   * 指定タブIDをペイン配列から空きペインに置き換える。
   * 有効ペインが0個になったら分割を解除する。
   */
  function replaceTabWithEmpty(tabId: number) {
    if (!isSplitMode.value) return;
    const ids = splitPaneTabIds.value.map((id) => (id === tabId ? nextEmptyId() : id));
    // exitSplitMode は現在の splitPaneTabIds から復帰先タブを探すため、
    // 呼ぶ前に置き換え後の状態を反映しておく（そうしないと今まさに外した
    // tabId 自身が誤って復帰先候補として拾われる）。
    splitPaneTabIds.value = ids;
    if (countRealPanes(ids) === 0) {
      exitSplitMode();
    }
  }

  /**
   * 分割を解除し、必ず有効な（openTabsに存在する）タブがアクティブになるようにする。
   * targetTabId未指定時は、アクティブペインの実タブ→ペイン内の最初の実タブの順に
   * フォールバックして terminalStore.switchTab を呼ぶ。呼び出し元はswitchTabを
   * 別途呼ぶ必要はない。
   */
  function exitSplitMode(targetTabId?: number | null): number | null {
    const ids = splitPaneTabIds.value;
    const activeId = ids[activePaneIndex.value];
    const restoreTabId = targetTabId
      ?? (activeId != null && !isEmptyPaneId(activeId) ? (activeId as number) : null)
      ?? realTabIds(ids)[0]
      ?? null;
    isSplitMode.value = false;
    splitPaneTabIds.value = [];
    activePaneIndex.value = 0;
    if (restoreTabId != null) {
      useTerminalStore().switchTab(restoreTabId);
    }
    return restoreTabId;
  }

  /**
   * 指定インデックスの空きペインの隣に新しい空きペインを追加する
   * （SplitEmptyPane の Add pane ボタンから呼ばれる）。現在のレイアウト軸は変更しない。
   * 開いているタブ数を超えてペインを増やしても埋められないため、そこで打ち止めにする。
   */
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
   * 指定インデックスの空きペインをペイン配列から削除する（SplitEmptyPane のタイトル横の
   * ×ボタンから呼ばれる）。残りペインが1つになったら分割を解除し、それが実タブなら
   * 切り替え先として返す（呼び出し元で terminalStore.switchTab するため）。
   * @returns 切り替え先タブID（分割解除時のみ）
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
    isPanelBottom,
    isTouchDevice,
    isPwa,
    isSettingsOpen,
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
