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
   * 呼び出し順に加えて isRestored（ストアが synced の間だけ true）でも
   * ガードする — 復元に失敗したまま保存を許すと、突き合わせ前の一覧のPUTが
   * サーバーの保存済み一覧や他クライアントの変更を上書きするため。
   *
   * 復元が失敗したままのセッションは、接続復帰（connectivity:back — useStatusStream
   * と同じ復帰シグナル）と _scheduleRestoreRetry() の定期再試行の両方で復元を
   * やり直して永続化を復活させる。未同期中のローカル操作はストアが記録し、
   * 遅れて成功した復元で失われない（applyServerState が突き合わせる）。
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
    // 成功（applyServerState）まで保存を止める。再マウント（ログアウト→再
    // ログイン等）でストアが synced のまま残っている場合もここで unsynced に
    // 戻り、失敗時に前回マウントの残骸一覧がPUTされることはない。
    browserTabStore.beginRestore();
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
