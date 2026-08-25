import { defineStore } from "pinia";
import { computed, ref } from "vue";
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
 * ## サーバーとの同期モデル（useBrowserTabsPersist.ts と対）
 *
 * 一覧はサーバー（/settings/browser-tabs）へ丸ごとPUTで保存されるため、
 * 「サーバーの最新一覧を知らないまま保存する」と他クライアントの変更を
 * 上書きしてしまう。これを防ぐため同期状態を1つの状態機械で持つ:
 *
 * - `unsynced`（初期状態 / beginRestore()後）: 保存は禁止。タブの開閉・URL変更は
 *   openedWhileUnsynced / removedWhileUnsynced にURL単位で記録される
 * - `synced`（applyServerState()成功後）: 保存が許可される。記録は行わない
 *
 * applyServerState() はサーバー一覧と未同期中のローカル操作記録を突き合わせて
 * 反映する: サーバー一覧から「未同期中に閉じたURL」を除き、「未同期中に開いた
 * URL」を後ろに足す。これにより (1)復元GET失敗中のローカル操作が遅れて成功した
 * 復元に消されない、(2)再マウント（ログアウト→再ログイン等）でストアに残った
 * 前回の残骸（記録に無いタブ）はサーバー状態で置き換えられ、他クライアントが
 * 閉じたタブを復活させない、(3)未同期中に閉じたタブも復元で蘇らない、が
 * 全て同じ仕組みで成り立つ。
 */
export const useBrowserTabStore = defineStore("browserTabs", () => {
  const tabs = ref<BrowserTab[]>([]);
  // nullの間はターミナル側が前面（ScreenMain.vueがTerminalBaseを表示）。
  const activeBrowserTabId = ref<number | null>(null);
  const syncState = ref<"unsynced" | "synced">("unsynced");
  // 保存可否のゲート（useBrowserTabsPersist の watcher が参照）。
  const isRestored = computed(() => syncState.value === "synced");

  // 未同期（unsynced）中のローカル操作の記録。applyServerState() の突き合わせに
  // 使い、成功時にクリアする。reactive にする必要は無い（表示には使わない）。
  const openedWhileUnsynced = new Set<string>();
  const removedWhileUnsynced = new Set<string>();
  // 未同期中にユーザーが明示的にターミナル側へ戻ったか。true のまま復元が
  // 成功した場合、サーバーの activeUrl ではターミナル前面を奪わない（遅れた
  // 復元がブラウザタブを勝手に前面へ出さないため）。ブラウザタブを開く/選ぶ
  // 操作で解除され、復元成功でクリアされる。
  let terminalChosenWhileUnsynced = false;

  function _recordOpen(url: string) {
    if (syncState.value === "synced") return;
    openedWhileUnsynced.add(url);
    removedWhileUnsynced.delete(url);
  }

  function _recordRemove(url: string) {
    if (syncState.value === "synced") return;
    openedWhileUnsynced.delete(url);
    removedWhileUnsynced.add(url);
  }

  /**
   * ターミナル側を前面に戻す（前面に出ているブラウザタブを退避させる）。
   * ScreenMain.vue の tab:select ハンドラが呼ぶため、どの経路（タブバー・
   * サイドバー・ディープリンク・dispatch等）でターミナルタブを選択しても
   * ブラウザタブが被ったままにならない。
   */
  function showTerminal() {
    activeBrowserTabId.value = null;
    if (syncState.value !== "synced") terminalChosenWhileUnsynced = true;
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
    _recordOpen(url);
    terminalChosenWhileUnsynced = false;
    return tab.id;
  }

  function selectBrowserTab(id: number) {
    if (!tabs.value.some((t) => t.id === id)) return;
    activeBrowserTabId.value = id;
    terminalChosenWhileUnsynced = false;
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
    _recordRemove(tab.url);
    _recordOpen(url);
    tabs.value.splice(idx, 1, { ...tab, url, label: browserTabLabelFromUrl(url) });
  }

  /**
   * 閉じたタブがアクティブだった場合、他のブラウザタブがあればそれへ、
   * 無ければターミナル側（null）へフォールバックする。
   */
  function closeBrowserTab(id: number) {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [closed] = tabs.value.splice(idx, 1);
    _recordRemove(closed.url);
    if (activeBrowserTabId.value !== id) return;
    const fallback = tabs.value[Math.min(idx, tabs.value.length - 1)];
    activeBrowserTabId.value = fallback ? fallback.id : null;
  }

  /**
   * 復元（サーバーGET）の開始を宣言し、成功（applyServerState）まで保存を
   * 止める。復元済みストアでの再復元（再マウント）でも呼ぶこと — 失敗した
   * まま保存を許すと、突き合わせ前の一覧のPUTが他クライアントの変更を
   * 上書きするため。既に unsynced なら何もしない（操作記録は継続する）。
   */
  function beginRestore() {
    syncState.value = "unsynced";
  }

  /**
   * サーバーの一覧と未同期中のローカル操作記録を突き合わせて反映し、synced へ
   * 遷移する。タブidは反映のたびに振り直すため、アクティブタブはURLで突き合わ
   * せる（今見ているタブが結果にも残るならそれを優先し、無ければサーバーの
   * activeUrl）。labelは持たず常にURLから導出する（永続化された値を信頼しない —
   * 導出ロジックを変更した際に古いデータが古い表示のまま固まるのを防ぐ）。
   *
   * @returns ローカル操作の記録が結果を変えたか（true ならサーバーがまだ知らない
   *   差分があるので、呼び出し側は保存をスケジュールすること）。
   */
  function applyServerState(serverTabs: { url: string }[], activeUrl: string | null): boolean {
    const serverKept = serverTabs.filter((s) => !removedWhileUnsynced.has(s.url));
    const localOpened = tabs.value.filter(
      (t) => openedWhileUnsynced.has(t.url) && !serverKept.some((s) => s.url === t.url),
    );
    const changedLocally = serverKept.length !== serverTabs.length || localOpened.length > 0;
    const currentActive = tabs.value.find((t) => t.id === activeBrowserTabId.value);
    tabs.value = [...serverKept.map((s) => s.url), ...localOpened.map((t) => t.url)].map((url) => {
      idCounter += 1;
      return { id: idCounter, url, label: browserTabLabelFromUrl(url) };
    });
    // 今見ているタブが結果にも残るならアクティブ維持。未同期中にユーザーが
    // 明示的にターミナルへ戻っていた場合は、サーバーの activeUrl で前面を
    // 奪い返さない（遅れた復元によるフォーカスの横取り防止）。
    const preferredUrl =
      currentActive && tabs.value.some((t) => t.url === currentActive.url)
        ? currentActive.url
        : terminalChosenWhileUnsynced
          ? null
          : activeUrl;
    activeBrowserTabId.value = tabs.value.find((t) => t.url === preferredUrl)?.id ?? null;
    openedWhileUnsynced.clear();
    removedWhileUnsynced.clear();
    terminalChosenWhileUnsynced = false;
    syncState.value = "synced";
    return changedLocally;
  }

  return {
    tabs, activeBrowserTabId, isRestored,
    openBrowserTab, selectBrowserTab, closeBrowserTab, updateBrowserTabUrl,
    beginRestore, applyServerState,
    showTerminal, setBrowserTabLoading,
  };
});
