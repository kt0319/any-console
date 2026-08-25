import { defineStore } from "pinia";
import { ref } from "vue";
import { browserTabLabelFromUrl } from "../utils/browser-tab-url.ts";

export interface BrowserTab {
  id: number;
  url: string;
  label: string;
  // iframeがナビゲーション中かどうか（BrowserPane.vueがload/reloadに合わせて
  // 更新する一時的な状態）。ターミナルタブのagentState==="working"と同じ
  // tab-working演出に使うだけで、永続化はしない
  // （useBrowserTabsPersist.tsが保存時に明示的に除外している）。
  loading?: boolean;
}

// タブIDはterminalStoreのterminalIdCounterとは独立した別名前空間（衝突しても
// 実害は無い — 参照先はopenTabs/browserTabsそれぞれ別配列のため）。
let idCounter = 0;

/**
 * dev serverプレビュー用の「ブラウザタブ」。タブバーに通常のターミナルタブと
 * 並んで表示される（TabBar.vue）。tmuxセッションを持たないため
 * terminalStore.openTabsとは別管理にし、useSessionSync等のサーバ側セッション
 * 同期ポーリング（サーバに無いsessionIdのタブを自動で閉じる）の対象外にする。
 *
 * 永続化はターミナルタブと同じ形（サーバー側JSON + 起動時復元）に揃えて
 * useBrowserTabsPersist.ts が担う。ここは純粋なクライアント状態だけを持つ
 * （useLayoutStore/useTerminalStoreとuseLayoutPersist.tsの分離と同じ方針）。
 */
export const useBrowserTabStore = defineStore("browserTabs", () => {
  const tabs = ref<BrowserTab[]>([]);
  // nullの間はターミナル側が前面（ScreenMain.vueがTerminalBaseを表示）。
  const activeBrowserTabId = ref<number | null>(null);
  // useBrowserTabsPersist.restoreBrowserTabs() 完了前は保存を走らせない
  // （空配列で上書きしてしまうため）。
  const isRestored = ref(false);

  /**
   * ターミナル側を前面に戻す（前面に出ているブラウザタブを退避させる）。
   * ScreenMain.vue の tab:select ハンドラが呼ぶため、どの経路（タブバー・
   * サイドバー・ディープリンク・dispatch等）でターミナルタブを選択しても
   * ブラウザタブが被ったままにならない。
   */
  function showTerminal() {
    activeBrowserTabId.value = null;
  }

  /**
   * iframeのload/reloadに合わせてBrowserPane.vueが呼ぶ。tabオブジェクトの
   * プロパティを直接書き換える（配列を置き換えない）ため、
   * useBrowserTabsPersist.tsのshallow watchは反応せず、保存も走らない
   * （ロード中フラグの変化は保存対象ではないため意図通り）。
   */
  function setBrowserTabLoading(id: number, loading: boolean) {
    const tab = tabs.value.find((t) => t.id === id);
    if (tab) tab.loading = loading;
  }

  /**
   * 同じURLのタブが既にあればそれをアクティブにするだけ（重複して開かない）。
   */
  function openBrowserTab(url: string): number {
    const existing = tabs.value.find((t) => t.url === url);
    if (existing) {
      activeBrowserTabId.value = existing.id;
      return existing.id;
    }
    idCounter += 1;
    const tab: BrowserTab = { id: idCounter, url, label: browserTabLabelFromUrl(url) };
    tabs.value.push(tab);
    activeBrowserTabId.value = tab.id;
    return tab.id;
  }

  function selectBrowserTab(id: number) {
    if (tabs.value.some((t) => t.id === id)) activeBrowserTabId.value = id;
  }

  /**
   * URL編集（BrowserPane.vueの地球儀アイコン→usePrompt）でタブのURLを書き換える。
   * ラベルは常にURLのホスト名から導出するため、新URLに合わせて再計算する。
   * splice で配列を置き換えることで useBrowserTabsPersist.ts の shallow watch
   * （tabs.slice()）にも変化を検知させる（プロパティの直接書き換えでは検知されない）。
   */
  function updateBrowserTabUrl(id: number, url: string) {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = tabs.value[idx];
    tabs.value.splice(idx, 1, { ...tab, url, label: browserTabLabelFromUrl(url) });
  }

  /**
   * 閉じたタブがアクティブだった場合、他のブラウザタブがあればそれへ、
   * 無ければターミナル側（null）へフォールバックする。
   */
  function closeBrowserTab(id: number) {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tabs.value.splice(idx, 1);
    if (activeBrowserTabId.value !== id) return;
    const fallback = tabs.value[Math.min(idx, tabs.value.length - 1)];
    activeBrowserTabId.value = fallback ? fallback.id : null;
  }

  /**
   * サーバーから復元したタブ一覧を反映する（useBrowserTabsPersist.restoreBrowserTabsから
   * のみ呼ぶ）。idは再読込のたびに振り直すため、アクティブタブはURLで突き合わせる。
   * labelは持たず常にURLから導出する（永続化された値を信頼しない — 導出ロジック
   * を変更した際に古いデータが古いままの表示で固まるのを防ぐ）。
   */
  function restoreFromServer(persisted: { url: string }[], activeUrl: string | null) {
    tabs.value = persisted.map((p) => {
      idCounter += 1;
      return { id: idCounter, url: p.url, label: browserTabLabelFromUrl(p.url) };
    });
    activeBrowserTabId.value = tabs.value.find((t) => t.url === activeUrl)?.id ?? null;
    isRestored.value = true;
  }

  return {
    tabs, activeBrowserTabId, isRestored,
    openBrowserTab, selectBrowserTab, closeBrowserTab, updateBrowserTabUrl, restoreFromServer,
    showTerminal, setBrowserTabLoading,
  };
});
