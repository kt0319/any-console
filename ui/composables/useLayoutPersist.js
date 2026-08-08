import { watch } from "vue";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useAuthStore } from "../stores/auth.js";
import { isEmptyPaneId, makeEmptyPaneId } from "../utils/empty-pane.js";
import { EP_SETTINGS_LAYOUT } from "../utils/endpoints.js";
import { LAYOUT_SAVE_DEBOUNCE_MS as SAVE_DEBOUNCE_MS } from "../utils/constants.js";

let _saveTimer = null;

function cancelSaveTimer() {
  if (_saveTimer != null) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
}

/**
 * 分割モードの状態をサーバーに保存・復元するコンポーザブル。
 *
 * - 分割状態の変化を監視し debounce してサーバーへ PUT する。
 * - 分割解除時はサーバーの保存状態を DELETE で消す。
 * - 復元は restoreLayout() を呼び出す側（useSessionSync）が行う。
 */
export function useLayoutPersist() {
  const layoutStore = useLayoutStore();
  const terminalStore = useTerminalStore();
  const auth = useAuthStore();

  function _tabIdToSessionId(tabId) {
    if (isEmptyPaneId(tabId)) return null;
    const tab = terminalStore.openTabs.find((t) => t.id === tabId);
    return tab?.sessionId ?? null;
  }

  async function _saveNow() {
    if (!layoutStore.isSplitMode) {
      try { await auth.apiFetch(EP_SETTINGS_LAYOUT, { method: "DELETE" }); } catch {}
      return;
    }
    const session_ids = layoutStore.splitPaneTabIds.map(_tabIdToSessionId);
    try {
      await auth.apiFetch(EP_SETTINGS_LAYOUT, {
        method: "PUT",
        body: {
          session_ids,
          layout: layoutStore.splitLayout || "horizontal",
          active_pane_index: layoutStore.activePaneIndex,
        },
      });
    } catch {}
  }

  function _scheduleSave() {
    cancelSaveTimer();
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      _saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * セッション復元後に呼び出す。サーバーに保存された分割状態を読んで
   * session_id → tab.id に変換し、分割モードを再適用する。
   */
  async function restoreLayout() {
    let data;
    try {
      const res = await auth.apiFetch(EP_SETTINGS_LAYOUT);
      if (!res || !res.ok) return;
      data = await res.json();
    } catch {
      return;
    }
    const split = data?.split;
    if (!split || !Array.isArray(split.session_ids) || split.session_ids.length < 2) return;

    let emptySeq = 0;
    const tabIds = split.session_ids.map((sid) => {
      if (!sid) return makeEmptyPaneId(++emptySeq);
      const tab = terminalStore.openTabs.find((t) => t.sessionId === sid);
      return tab ? tab.id : makeEmptyPaneId(++emptySeq);
    });

    layoutStore.splitPaneTabIds = tabIds;
    layoutStore.splitLayout = split.layout || "horizontal";
    layoutStore.activePaneIndex = Math.min(split.active_pane_index ?? 0, tabIds.length - 1);
    layoutStore.isSplitMode = true;
  }

  function startWatching() {
    watch(
      () => [
        layoutStore.isSplitMode,
        layoutStore.splitPaneTabIds.slice(),
        layoutStore.splitLayout,
        layoutStore.activePaneIndex,
      ],
      () => _scheduleSave(),
      { deep: false },
    );
  }

  return { startWatching, restoreLayout };
}
