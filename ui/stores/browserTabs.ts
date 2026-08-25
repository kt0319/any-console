import { defineStore } from "pinia";
import { ref } from "vue";

export interface BrowserTab {
  id: number;
  url: string;
  label: string;
  // 開いた元のdev serverが紐づくワークスペースのアイコン。無ければ
  // BrowserTabItem.vue側でserverアイコン（mdi-server）にフォールバックする。
  icon?: string | null;
  iconColor?: string | null;
  // iframeがナビゲーション中かどうか（BrowserPane.vueがload/reloadに合わせて
  // 更新する一時的な状態）。ターミナルタブのagentState==="working"と同じ
  // tab-working演出に使うだけで、永続化はしない
  // （useBrowserTabsPersist.tsが保存時に明示的に除外している）。
  loading?: boolean;
}

// タブIDはterminalStoreのterminalIdCounterとは独立した別名前空間（衝突しても
// 実害は無い — 参照先はopenTabs/browserTabsそれぞれ別配列のため）。
let idCounter = 0;

// labelが指定されなかった時のフォールバック。フルURLはタブ幅に対して長すぎ、
// クエリ文字列等のノイズも含むため、ホスト名だけに短縮する。
function shortLabelFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

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

  // BrowserPane.vueが自身のiframeを再読み込みする関数をタブIDごとに登録する
  // レジストリ（DOM操作を伴う命令的な処理のためreactive stateには乗せない）。
  // SessionListView.vueのサイドバー行など、対象タブが非アクティブでもiframe
  // 自体は v-show でマウントされ続けているため、reloadBrowserTab はどのタブに
  // 対しても呼べる。
  const reloadHandlers = new Map<number, () => void>();

  function registerReloadHandler(id: number, handler: () => void) {
    reloadHandlers.set(id, handler);
  }

  function unregisterReloadHandler(id: number) {
    reloadHandlers.delete(id);
  }

  function reloadBrowserTab(id: number) {
    reloadHandlers.get(id)?.();
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
  function openBrowserTab(url: string, opts: { label?: string, icon?: string | null, iconColor?: string | null } = {}): number {
    const existing = tabs.value.find((t) => t.url === url);
    if (existing) {
      activeBrowserTabId.value = existing.id;
      return existing.id;
    }
    idCounter += 1;
    const tab: BrowserTab = { id: idCounter, url, label: opts.label || shortLabelFromUrl(url), icon: opts.icon, iconColor: opts.iconColor };
    tabs.value.push(tab);
    activeBrowserTabId.value = tab.id;
    return tab.id;
  }

  function selectBrowserTab(id: number) {
    if (tabs.value.some((t) => t.id === id)) activeBrowserTabId.value = id;
  }

  /**
   * URL編集（BrowserPane.vueの地球儀アイコン→usePrompt）でタブのURLを書き換える。
   * ラベルが元のURLのホスト名フォールバックのまま（ワークスペース名等の
   * 明示ラベルが無い）場合は、新URLのホスト名に追従させる。splice で配列を
   * 置き換えることで useBrowserTabsPersist.ts の shallow watch（tabs.slice()）
   * にも変化を検知させる（プロパティの直接書き換えでは検知されない）。
   */
  function updateBrowserTabUrl(id: number, url: string) {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = tabs.value[idx];
    const label = tab.label === shortLabelFromUrl(tab.url) ? shortLabelFromUrl(url) : tab.label;
    tabs.value.splice(idx, 1, { ...tab, url, label });
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
   */
  function restoreFromServer(persisted: { url: string, label: string, icon?: string | null, iconColor?: string | null }[], activeUrl: string | null) {
    tabs.value = persisted.map((p) => {
      idCounter += 1;
      return { id: idCounter, url: p.url, label: p.label, icon: p.icon, iconColor: p.iconColor };
    });
    activeBrowserTabId.value = tabs.value.find((t) => t.url === activeUrl)?.id ?? null;
    isRestored.value = true;
  }

  return {
    tabs, activeBrowserTabId, isRestored,
    openBrowserTab, selectBrowserTab, closeBrowserTab, updateBrowserTabUrl, restoreFromServer,
    registerReloadHandler, unregisterReloadHandler, reloadBrowserTab, setBrowserTabLoading,
  };
});
