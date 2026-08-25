import { watch } from "vue";
import { useBrowserTabStore } from "../stores/browserTabs.ts";
import { useAuthStore } from "../stores/auth.ts";
import { EP_SETTINGS_BROWSER_TABS } from "../utils/endpoints.ts";
import { normalizeBrowserTabUrl } from "../utils/browser-tab-url.ts";
import { createSaveScheduler } from "../utils/save-scheduler.ts";
import { LAYOUT_SAVE_DEBOUNCE_MS as SAVE_DEBOUNCE_MS } from "../utils/constants.ts";
import { on } from "../app-bridge.ts";

const _saver = createSaveScheduler(SAVE_DEBOUNCE_MS);

// 実行中の復元GET（無ければnull）。接続復帰イベントは短時間に複数回発火しうる
// （useConnectivityMonitorはonline即時とヘルスチェック後の2回emitすることが
// ある）ため、並行GETを許すと先に復元が完了した後のユーザー操作を、遅れて
// 返ってきた2本目の応答が上書きしてしまう。実行中があればそれを共有する。
let _restoreInFlight: Promise<void> | null = null;

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
    _saver.schedule(_saveNow);
  }

  /**
   * restoreBrowserTabs() 完了後に呼ぶこと。復元前に変化を監視すると、
   * 空配列の初期状態でサーバーの保存済みタブを上書きしてしまう。
   * 呼び出し順に加えて isRestored でもガードする — 復元に失敗したセッション
   * （isRestored が false のまま）で保存を許すと、その後タブを1つ開いた時点で
   * サーバーの保存済みタブ一覧を新しい一覧で上書き消去してしまうため。
   *
   * 復元が失敗したままのセッションは、接続復帰（connectivity:back — 復元GETが
   * 落ちる典型原因はネットワーク断のため、useStatusStream と同じ復帰シグナルを
   * 使う）で復元をやり直して永続化を復活させる。restoreBrowserTabs() は
   * ローカルで既に開かれたタブをサーバー分とマージするため、遅れて成功しても
   * どちらの状態も失われない。
   *
   * @returns watch と connectivity:back 購読を解除するクリーンアップ関数
   *   （実運用ではアプリと同寿命のため未使用。テスト間の分離用）。
   */
  function startWatching(): () => void {
    const stopWatch = watch(
      () => [browserTabStore.tabs.slice(), browserTabStore.activeBrowserTabId],
      () => {
        if (!browserTabStore.isRestored) return;
        _scheduleSave();
      },
      { deep: false },
    );
    const offConnectivity = on("connectivity:back", () => {
      if (!browserTabStore.isRestored) restoreBrowserTabs();
    });
    return () => {
      stopWatch();
      offConnectivity();
    };
  }

  async function _restoreNow() {
    try {
      const res = await auth.apiFetch(EP_SETTINGS_BROWSER_TABS);
      if (!res || !res.ok) return;
      const data = await res.json();
      // 正規化して保持する（フィルタだけでは不十分）: 旧データや手編集された
      // config.json の `https:example.com` のような値を生のまま残すと、次の
      // 保存PUTがサーバーの literal な prefix 検証（422）で丸ごと失敗し、その
      // セッションの変更が全て失われる。http/https 以外は除外する。
      const serverTabs: { url: string }[] = (Array.isArray(data?.tabs) ? data.tabs : [])
        .map((t: { url?: unknown }) => normalizeBrowserTabUrl(t?.url))
        .filter((u: string | null): u is string => u != null)
        .map((url: string) => ({ url }));
      // ローカルタブとのマージは「このストアがまだ一度も復元に成功していない」
      // 時だけ行う（復元GETの失敗後にローカルで開かれたタブを、connectivity:back
      // のリトライで遅れて成功した復元が消さないため。アクティブタブもローカル
      // 優先）。復元済みのストアで再度呼ばれた場合（ログアウト→再ログイン等で
      // ScreenMain が再マウントされた時）はサーバー状態で置き換える — 前回
      // マウントの残骸をローカル新規タブと誤認してマージすると、他クライアント
      // が意図して閉じたタブを復活させてしまうため。
      const shouldMerge = !browserTabStore.isRestored;
      const localUrls = shouldMerge
        ? browserTabStore.tabs.map((t) => t.url).filter((u) => !serverTabs.some((s) => s.url === u))
        : [];
      const merged = [...serverTabs, ...localUrls.map((url) => ({ url }))];
      const localActive = shouldMerge
        ? browserTabStore.tabs.find((t) => t.id === browserTabStore.activeBrowserTabId)
        : undefined;
      const activeUrl = localActive?.url ?? normalizeBrowserTabUrl(data?.activeUrl);
      browserTabStore.restoreFromServer(merged, activeUrl);
      // ローカル分をマージした場合はサーバーがまだ知らないので反映しておく。
      if (localUrls.length > 0) _scheduleSave();
    } catch {
      // 復元に失敗した場合は isRestored を立てず、このセッションでは保存を
      // 走らせない（空の一覧でサーバーの保存済みタブを上書きしないため）。
      // 接続復帰時に startWatching() 側のリトライが復元をやり直す。
    }
  }

  function restoreBrowserTabs(): Promise<void> {
    if (!_restoreInFlight) {
      _restoreInFlight = _restoreNow().finally(() => {
        _restoreInFlight = null;
      });
    }
    return _restoreInFlight;
  }

  return { startWatching, restoreBrowserTabs };
}
