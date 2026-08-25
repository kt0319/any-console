import { watch } from "vue";
import { useBrowserTabStore } from "../stores/browserTabs.ts";
import { useAuthStore } from "../stores/auth.ts";
import { EP_SETTINGS_BROWSER_TABS } from "../utils/endpoints.ts";
import { normalizeBrowserTabUrl } from "../utils/browser-tab-url.ts";
import { createSaveScheduler } from "../utils/save-scheduler.ts";
import {
  BROWSER_TABS_RESTORE_RETRY_MS,
  LAYOUT_SAVE_DEBOUNCE_MS as SAVE_DEBOUNCE_MS,
} from "../utils/constants.ts";
import { on } from "../app-bridge.ts";

const _saver = createSaveScheduler(SAVE_DEBOUNCE_MS);

// 実行中の復元GET（無ければnull）。接続復帰イベントは短時間に複数回発火しうる
// （useConnectivityMonitorはonline即時とヘルスチェック後の2回emitすることが
// ある）ため、並行GETを許すと先に復元が完了した後のユーザー操作を、遅れて
// 返ってきた2本目の応答が上書きしてしまう。実行中があればそれを共有する。
let _restoreInFlight: Promise<void> | null = null;

// 失敗した復元の再試行タイマー。connectivity:back が発火しない失敗
// （429/500等 — 接続自体は生きている）でも復元を諦めないための保険。
let _retryTimer: ReturnType<typeof setTimeout> | null = null;

// 「復元済みストアへの再復元」開始時点のタブURL集合（ストアごと）。
// 再マウント（ログアウト→再ログイン等）でストアに残った前回マウントの残骸を、
// 復元成功時のマージ対象から除外するための記録。復元が成功したら消す。
const _staleUrlsByStore = new WeakMap<object, Set<string>>();

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
   * 復元が失敗したままのセッションは、接続復帰（connectivity:back — useStatusStream
   * と同じ復帰シグナル）と _scheduleRestoreRetry() の定期再試行の両方で復元を
   * やり直して永続化を復活させる。restoreBrowserTabs() はローカルで既に開かれた
   * タブをサーバー分とマージするため、遅れて成功してもどちらの状態も失われない。
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
      _clearRetryTimer();
    };
  }

  function _clearRetryTimer() {
    if (_retryTimer != null) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
    }
  }

  /**
   * 復元失敗時の再試行を予約する。connectivity:back は接続断からの復帰でしか
   * 発火しないため、レートリミット（429。/settings/browser-tabs は対象で
   * /auth/check は対象外）やサーバーエラー（500）による失敗はこのタイマーが
   * 唯一のリトライ経路になる。成功するまで一定間隔で繰り返す。
   */
  function _scheduleRestoreRetry() {
    _clearRetryTimer();
    _retryTimer = setTimeout(() => {
      _retryTimer = null;
      if (!browserTabStore.isRestored) restoreBrowserTabs();
    }, BROWSER_TABS_RESTORE_RETRY_MS);
  }

  async function _restoreNow() {
    // 復元済みストアへの再復元（ログアウト→再ログイン等でScreenMainが再マウント
    // された時）: この時点のタブ一覧は前回マウントの残骸なので、(1)復元が成功する
    // まで保存を止め（isRestored=false — 失敗したまま保存を許すと残骸一覧のPUTが
    // 他クライアントの変更を上書きする）、(2)成功時のマージ対象からも除外する
    // （残骸を「ローカル新規」と誤認してマージすると、他クライアントが意図して
    // 閉じたタブを復活させてしまう）。
    if (browserTabStore.isRestored) {
      _staleUrlsByStore.set(browserTabStore, new Set(browserTabStore.tabs.map((t) => t.url)));
      browserTabStore.isRestored = false;
    }
    const staleUrls = _staleUrlsByStore.get(browserTabStore);
    try {
      const res = await auth.apiFetch(EP_SETTINGS_BROWSER_TABS);
      if (!res || !res.ok) {
        _scheduleRestoreRetry();
        return;
      }
      const data = await res.json();
      // 正規化して保持する（フィルタだけでは不十分）: 旧データや手編集された
      // config.json の `https:example.com` のような値を生のまま残すと、次の
      // 保存PUTがサーバーの literal な prefix 検証（422）で丸ごと失敗し、その
      // セッションの変更が全て失われる。http/https 以外は除外する。
      const serverTabs: { url: string }[] = (Array.isArray(data?.tabs) ? data.tabs : [])
        .map((t: { url?: unknown }) => normalizeBrowserTabUrl(t?.url))
        .filter((u: string | null): u is string => u != null)
        .map((url: string) => ({ url }));
      // 復元GETの失敗後にローカルで開かれたタブはサーバー分の後ろへマージして
      // 残す（遅れて成功した復元がローカル操作を消さないため）。再マウントの
      // 残骸（staleUrls）はマージしない。
      const localUrls = browserTabStore.tabs
        .map((t) => t.url)
        .filter((u) => !serverTabs.some((s) => s.url === u) && !staleUrls?.has(u));
      const merged = [...serverTabs, ...localUrls.map((url) => ({ url }))];
      // 今見ているタブがマージ後も存在するならアクティブを維持し、無ければ
      // サーバーの activeUrl（正規化済み）へフォールバックする。
      const localActive = browserTabStore.tabs.find((t) => t.id === browserTabStore.activeBrowserTabId);
      const activeUrl =
        localActive && merged.some((m) => m.url === localActive.url)
          ? localActive.url
          : normalizeBrowserTabUrl(data?.activeUrl);
      browserTabStore.restoreFromServer(merged, activeUrl);
      _staleUrlsByStore.delete(browserTabStore);
      _clearRetryTimer();
      // ローカル分をマージした場合はサーバーがまだ知らないので反映しておく。
      if (localUrls.length > 0) _scheduleSave();
    } catch {
      // 復元に失敗した場合は isRestored を立てず、このセッションでは保存を
      // 走らせない（空の一覧でサーバーの保存済みタブを上書きしないため）。
      // connectivity:back と下のタイマーの両方が復元をやり直す。
      _scheduleRestoreRetry();
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
