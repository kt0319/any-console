import { watch } from "vue";
import { useBrowserTabStore } from "../stores/browserTabs.ts";
import { useAuthStore } from "../stores/auth.ts";
import { EP_SETTINGS_BROWSER_TABS } from "../utils/endpoints.ts";
import { LAYOUT_SAVE_DEBOUNCE_MS as SAVE_DEBOUNCE_MS } from "../utils/constants.ts";

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * ブラウザタブ一覧をサーバー（/settings/browser-tabs）へ保存・復元する
 * コンポーザブル。ターミナルタブの useLayoutPersist.ts と同じ形（変化を
 * watch して debounce PUT、起動時に GET で復元）に揃える。tmuxセッションの
 * ようなサーバー側の実体を持たないため、一覧自体をここで永続化する。
 */
export function useBrowserTabsPersist() {
  const browserTabStore = useBrowserTabStore();
  const auth = useAuthStore();

  async function _saveNow() {
    const activeTab = browserTabStore.tabs.find((t) => t.id === browserTabStore.activeBrowserTabId);
    try {
      await auth.apiFetch(EP_SETTINGS_BROWSER_TABS, {
        method: "PUT",
        body: {
          tabs: browserTabStore.tabs.map((t) => ({ url: t.url })),
          activeUrl: activeTab ? activeTab.url : null,
        },
      });
    } catch {}
  }

  function _scheduleSave() {
    if (_saveTimer != null) { clearTimeout(_saveTimer); _saveTimer = null; }
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      _saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * restoreBrowserTabs() 完了後に呼ぶこと。復元前に変化を監視すると、
   * 空配列の初期状態でサーバーの保存済みタブを上書きしてしまう。
   */
  function startWatching() {
    watch(
      () => [browserTabStore.tabs.slice(), browserTabStore.activeBrowserTabId],
      () => _scheduleSave(),
      { deep: false },
    );
  }

  async function restoreBrowserTabs() {
    try {
      const res = await auth.apiFetch(EP_SETTINGS_BROWSER_TABS);
      if (!res || !res.ok) return;
      const data = await res.json();
      browserTabStore.restoreFromServer(Array.isArray(data?.tabs) ? data.tabs : [], data?.activeUrl ?? null);
    } catch {
      browserTabStore.isRestored = true;
    }
  }

  return { startWatching, restoreBrowserTabs };
}
