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
// ある）ため、並行GETを1本にまとめる。仮に競合しても store 側の操作記録で
// 突き合わせされるが、無駄なGET自体を避ける。
let _restoreInFlight: Promise<void> | null = null;

// 失敗した復元の再試行タイマー。connectivity:back が発火しない失敗
// （429/500等 — 接続自体は生きている）でも復元を諦めないための保険。
let _retryTimer: ReturnType<typeof setTimeout> | null = null;

// 稼働中の watcher 数（startWatching で+1、クリーンアップで-1）。0 の間は
// 再試行を予約しない — 復元GETがアンマウント後に解決した場合、その失敗経路が
// クリーンアップ後に新しいタイマーを積んでログイン画面でポーリングし続けるのを
// 防ぐ（クリーンアップは実行時点のタイマーしか消せないため、予約側で止める）。
let _activeWatchers = 0;

/**
 * ブラウザタブ一覧をサーバー（/settings/browser-tabs）へ保存・復元する
 * コンポーザブル。ターミナルタブの useLayoutPersist.ts と同じ形（変化を
 * watch して debounce PUT、起動時に GET で復元）に揃える。tmuxセッションの
 * ようなサーバー側の実体を持たないため、一覧自体をここで永続化する。
 *
 * 同期の整合性（保存の可否・未同期中のローカル操作とサーバー一覧の突き合わせ）
 * はストア側の状態機械（browserTabs.ts の beginRestore / applyServerState /
 * isRestored）が担う。ここが持つのはHTTPまわりだけ: GET/PUT・URLの正規化・
 * 失敗時の再試行（connectivity:back + 定期タイマー）・並行GETの抑制。
 */
export function useBrowserTabsPersist() {
  const browserTabStore = useBrowserTabStore();
  const auth = useAuthStore();

  async function _saveNow() {
    // debounce中に beginRestore された場合の最終ガード（キューは restore 開始時に
    // cancel されるが、実行順の隙間で発火しても未同期の一覧をPUTしない）。
    if (!browserTabStore.isRestored) return;
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
   * restoreBrowserTabs() を await する「前」に呼び、返り値のクリーンアップを
   * 必ずアンマウント時に実行できる場所（ScreenMain の bridgeCleanups）へ
   * 同期的に登録すること — await の後に登録すると、復元GET中のアンマウントで
   * 解除不能な watcher / リスナーが残る。復元前に監視を始めても安全:
   * watcher は isRestored（ストアが synced の間だけ true）でガードされており、
   * 復元前・復元失敗中の一覧が保存されることはない（突き合わせ前の一覧のPUTは
   * サーバーの保存済み一覧や他クライアントの変更を上書きするため）。
   *
   * 復元が失敗したままのセッションは、接続復帰（connectivity:back — useStatusStream
   * と同じ復帰シグナル）と _scheduleRestoreRetry() の定期再試行の両方で復元を
   * やり直して永続化を復活させる。未同期中のローカル操作はストアが記録し、
   * 遅れて成功した復元で失われない（applyServerState が突き合わせる）。
   *
   * @returns watch と connectivity:back 購読を解除し再試行を止める
   *   クリーンアップ関数。アンマウント時に必ず呼ぶこと。
   */
  function startWatching(): () => void {
    _activeWatchers += 1;
    // データ本体ではなく「ユーザー操作バージョン」を watch する — データを
    // watch すると applyServerState() のタブ入れ替えでも保存が走り、無変更の
    // GETスナップショットをPUTして、GET後〜debounce満了の間に他クライアントが
    // 行った更新を巻き戻してしまう。復元由来の差分（マージ結果）は
    // _restoreNow() が changedLocally を見て明示的に保存する。
    const stopWatch = watch(
      () => browserTabStore.userMutationVersion,
      () => {
        if (!browserTabStore.isRestored) return;
        _scheduleSave();
      },
    );
    const offConnectivity = on("connectivity:back", () => {
      if (!browserTabStore.isRestored) restoreBrowserTabs();
    });
    return () => {
      _activeWatchers -= 1;
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
    // 購読者がいない（アンマウント済み）なら再試行しない — クリーンアップ後に
    // 解決した復元GETの失敗経路が、ログイン画面で永久ポーリングを始めないため。
    if (_activeWatchers === 0) return;
    _clearRetryTimer();
    _retryTimer = setTimeout(() => {
      _retryTimer = null;
      if (!browserTabStore.isRestored) restoreBrowserTabs();
    }, BROWSER_TABS_RESTORE_RETRY_MS);
  }

  async function _restoreNow() {
    // 成功（applyServerState）まで保存を止める。再マウント（ログアウト→再
    // ログイン等）でストアが synced のまま残っている場合もここで unsynced に
    // 戻り、失敗時に前回マウントの残骸一覧がPUTされることはない。直前の
    // debounce窓に積まれたままの保存も、古い一覧でサーバーを上書きしないよう
    // ここで破棄する（未保存だったその変更はサーバー状態が正となり失われる）。
    browserTabStore.beginRestore();
    _saver.cancel();
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
      const changedLocally = browserTabStore.applyServerState(
        serverTabs,
        normalizeBrowserTabUrl(data?.activeUrl),
      );
      _clearRetryTimer();
      // 未同期中のローカル操作が結果を変えた場合、サーバーはまだその差分を
      // 知らないので反映しておく。
      if (changedLocally) _scheduleSave();
    } catch {
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
