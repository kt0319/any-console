import { useAuthStore } from "../stores/auth.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminal } from "./useTerminal.js";
import { useLayoutPersist } from "./useLayoutPersist.js";
import { LAYOUT_FIT_DELAY_MS, LS_KEY_ACTIVE_SESSION, SESSION_SYNC_INTERVAL_MS, NEW_TAB_SYNC_GRACE_MS } from "../utils/constants.js";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES } from "../utils/endpoints.js";
import { loadAllJobs, loadSessionsResponse, buildSessionTabParams, applyCachedJobIcon, isJobDefResolved } from "../utils/session-jobs.js";
import { emit } from "../app-bridge.js";

// モジュールスコープ: サーバー応答の一時的な揺らぎで /terminal/sessions から
// セッションが消えてタブが削除→再生成されても、一度解決できたジョブアイコンは
// 保持する。再生成時に allJobs がまだ不完全で mdi-play フォールバックになった
// 場合、このキャッシュがあれば上書きしない（session_id -> { icon, iconColor }）。
const resolvedJobIcons = new Map();

// launchTerminal() 等、buildSessionTabParams を経由しない経路で既にジョブ
// アイコンが解決済みのときにキャッシュへ書き込む（useTerminalLifecycle.js から使用）。
// 呼び出し側は mdi-play フォールバック適用前の生のジョブアイコンを渡すこと。
export function rememberJobIcon(sessionId, icon, iconColor) {
  if (!sessionId || !icon) return;
  resolvedJobIcons.set(sessionId, { icon, iconColor: iconColor || null });
}

// buildSessionTabParams を直接呼ぶ全ての経路（ポーリング再構築・dispatch queue
// 実行・deep link アタッチ・Sessions編集モードの Open detached 等）で共通に使う。
// 解決できたジョブアイコンをキャッシュへ書き込み、かつ /jobs/workspaces が
// 一時的に不完全な時は既存キャッシュへフォールバックする（resolvedJobIcons を
// 経由しない経路が増えるたびに mdi-play 固定化の穴が再発しないようにする）。
export function buildSessionTabParamsWithCache(session, opts) {
  const built = buildSessionTabParams(session, opts);
  return applyCachedJobIcon(built, isJobDefResolved(session, opts.allJobs), session, resolvedJobIcons);
}

export function useSessionSync() {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const layoutStore = useLayoutStore();
  const { disconnectTerminal } = useTerminal();
  const { restoreLayout } = useLayoutPersist();

  function _buildTabParams(s, allJobs) {
    return { ...buildSessionTabParamsWithCache(s, { workspaces: workspaceStore.allWorkspaces, allJobs }), restored: true };
  }

  async function _safeResJson(res) {
    try {
      if (res && res.ok) return await res.json();
    } catch {}
    return {};
  }

  // allJobs が空のままジョブセッションを焼き込むと、アイコンが mdi-play に固定され
  // リロードまで直らない（tab.icon は markRaw で再解決されないため）。
  // /jobs/workspaces の一時失敗を想定し、ジョブセッションがあるのに空なら 1 回だけ再取得する。
  function _loadAllJobs(jobsRes, sessions) {
    return loadAllJobs(jobsRes, sessions, {
      readJson: _safeResJson,
      refetch: () => auth.apiFetch(EP_JOBS_WORKSPACES).catch(() => null),
    });
  }

  function _loadSessions(sessionsRes) {
    return loadSessionsResponse(sessionsRes, {
      refetch: () => auth.apiFetch(EP_TERMINAL_SESSIONS).catch(() => null),
    });
  }

  async function restoreExistingSessions(sessionsRes, jobsRes) {
    if (terminalStore.hasRestoredTabsFromStorage) return;
    terminalStore.restoreSessionsLoading = true;
    terminalStore.restoreSessionsError = "";
    try {
      // 一時失敗を defaults 同様に握りつぶすとタブ 0 件で確定するため、失敗時は再取得する。
      // 成功を確認できたときだけ「復元済み」フラグを立て、失敗時はポーリング等での復帰に委ねる。
      const res = await _loadSessions(sessionsRes);
      if (!res || !res.ok) {
        if (res) {
          terminalStore.restoreSessionsError = await res.text?.().catch(() => "") || "Failed to fetch existing sessions";
        }
        return;
      }
      terminalStore.hasRestoredTabsFromStorage = true;
      const sessions = await res.json();
      if (!Array.isArray(sessions) || sessions.length === 0) return;

      const savedOrder = await terminalStore.loadTabOrder();
      const orderMap = new Map(savedOrder.map((id, i) => [id, i]));
      const sortedSessions = [...sessions].sort((a, b) => {
        const ai = orderMap.get(a.session_id) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderMap.get(b.session_id) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return (a.created_at || 0) - (b.created_at || 0);
      });

      const allJobs = await _loadAllJobs(jobsRes, sortedSessions);
      for (const s of sortedSessions) {
        if (s.detached) continue; // detached セッションは Tabs パネルの Detached sessions に表示
        terminalStore.addTerminalTab(_buildTabParams(s, allJobs));
      }

      await restoreLayout();

      if (!layoutStore.isSplitMode) {
        const savedSessionId = localStorage.getItem(LS_KEY_ACTIVE_SESSION);
        const tabs = terminalStore.openTabs;
        const target = (savedSessionId && tabs.find((t) => t.sessionId === savedSessionId))
          || tabs[0];
        if (target) terminalStore.switchTab(target.id);
      }
      setTimeout(() => emit("layout:fitAll", { force: true }), LAYOUT_FIT_DELAY_MS);
    } catch (e) {
      console.error("restoreExistingSessions failed:", e);
      terminalStore.restoreSessionsError = (e instanceof Error ? e.message : "") || "Error restoring existing sessions";
    } finally {
      terminalStore.restoreSessionsLoading = false;
    }
  }

  async function syncSessionsFromServer() {
    try {
      const sessionsRes = await auth.apiFetch(EP_TERMINAL_SESSIONS).catch(() => null);
      if (!sessionsRes || !sessionsRes.ok) return;
      const sessions = await sessionsRes.json();
      if (!Array.isArray(sessions)) return;

      const serverSessionIds = new Set(sessions.map((s) => s.session_id));
      const localSessionIds = new Set(terminalStore.openTabs.map((t) => t.sessionId));
      // 他端末からのセッション追加など、ローカルにまだ無いセッションが実際にある
      // ときだけ /jobs/workspaces を叩く（毎ポーリングで無条件に叩くと、変化が無い
      // 大半のポーリングでも common jobs のマージが常時発生してしまうため）。
      const newSessions = sessions.filter((s) =>
        !s.detached && !terminalStore.pendingCloseSessionIds.has(s.session_id) && !localSessionIds.has(s.session_id),
      );

      if (newSessions.length) {
        const allJobs = await _loadAllJobs(null, newSessions);
        for (const s of newSessions) {
          const tab = terminalStore.addTerminalTab(_buildTabParams(s, allJobs));
          // interactive=false（外部ツールから /run を直接叩いた等、UIの操作を
          // 経由していないセッション）だけタブバーから隠す。UIの「+」等で別の
          // 端末から開かれたセッションは interactive=true で届くので、この
          // 端末のタブバーにも通常どおり表示される。
          if (!s.interactive) terminalStore.setTabFlag(tab.id, "autoDiscovered", true);
        }
      }

      for (const tab of [...terminalStore.openTabs]) {
        if (serverSessionIds.has(tab.sessionId)) continue;
        // 作成直後のタブは、このポーリングが発行された時点でまだサーバ側に
        // セッションが反映されていない可能性がある（起動レスポンス遅延とのレース）。
        // 猶予期間内は除去せず、次のポーリングでサーバが追いつくのを待つ。
        if (Date.now() - tab._createdAt < NEW_TAB_SYNC_GRACE_MS) continue;
        disconnectTerminal(tab);
        terminalStore.removeTab(tab.id);
      }
    } catch (e) {
      console.error("syncSessionsFromServer failed:", e);
    }
  }

  let syncIntervalId = null;

  function startSyncPolling() {
    stopSyncPolling();
    syncIntervalId = setInterval(() => syncSessionsFromServer(), SESSION_SYNC_INTERVAL_MS);
  }

  function stopSyncPolling() {
    if (syncIntervalId != null) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  }

  return { restoreExistingSessions, syncSessionsFromServer, startSyncPolling, stopSyncPolling };
}
