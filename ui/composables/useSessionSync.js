import { useAuthStore } from "../stores/auth.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminal } from "./useTerminal.js";
import { useLayoutPersist } from "./useLayoutPersist.js";
import { LAYOUT_FIT_DELAY_MS, LS_KEY_ACTIVE_SESSION, SESSION_SYNC_INTERVAL_MS } from "../utils/constants.js";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES } from "../utils/endpoints.js";
import { buildSessionTabParams, stalePendingCloseIds } from "../utils/session-jobs.js";
import { emit } from "../app-bridge.js";

// サーバの /terminal/sessions はスナップショット + last-known-good（ADR 24）で
// 一時失敗が「セッション消滅」として返ることはない。フロントはこの一覧を信頼して
// 毎ポーリング同じ reconcile（不足タブの追加・余剰タブの削除・表示メタの追随）を
// 冪等に適用するだけにし、リトライや個別の自己回復は持たない。
export function useSessionSync() {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const layoutStore = useLayoutStore();
  const { disconnectTerminal } = useTerminal();
  const { restoreLayout } = useLayoutPersist();

  function _buildTabParams(s, allJobs) {
    return buildSessionTabParams(s, { workspaces: workspaceStore.allWorkspaces, allJobs });
  }

  // ジョブ定義を JSON で返す。取得失敗は null（空 {} と区別する — 失敗を空と
  // 混同すると、既存ジョブタブのアイコンが mdi-play へ揺れ戻る）。
  async function _jobsJson(res) {
    try {
      if (res && res.ok) return await res.json();
    } catch {}
    return null;
  }

  /**
   * サーバのセッション一覧へタブ群を冪等に追随させる（復元・ポーリング共通）。
   * 追加・表示メタの更新のみ行う。削除は syncSessionsFromServer 側だけが行う
   * （復元初回は一覧が信頼できても、タブがまだ無いだけの可能性があるため）。
   * 追加タブは常に restored 扱い: ここで発見されるのは既存の tmux セッション
   * であり、スクロールバックの履歴復元が必要なため。
   * allJobs が null（取得失敗）の間は「ジョブタブの」メタ更新だけスキップし、
   * 誤ったフォールバックアイコン（mdi-play）で上書きしない。ジョブに依存
   * しないタブの workspace・ラベル更新は通す（ワークスペース紐付け直後の
   * 反映を jobs エンドポイントの不調で止めない）。
   */
  function _reconcileTabs(sessions, allJobs) {
    const tabBySession = new Map(terminalStore.openTabs.map((t) => [t.sessionId, t]));
    for (const s of sessions) {
      if (s.detached) continue; // detached セッションは Tabs パネルの Detached sessions に表示
      if (terminalStore.pendingCloseSessionIds.has(s.session_id)) continue;
      const tab = tabBySession.get(s.session_id);
      if (tab) {
        if (allJobs || !s.job_name) {
          terminalStore.applyTabMeta(tab.id, _buildTabParams(s, allJobs || {}));
        }
      } else {
        terminalStore.addTerminalTab({ ..._buildTabParams(s, allJobs || {}), restored: true });
      }
    }
  }

  async function restoreExistingSessions(sessionsRes, jobsRes) {
    if (terminalStore.hasRestoredTabsFromStorage) return;
    terminalStore.restoreSessionsLoading = true;
    terminalStore.restoreSessionsError = "";
    try {
      // 失敗時は「復元済み」にせず、同期ポーリングでのタブ追加に委ねる
      // （タブ 0 件のまま確定させない）。
      if (!sessionsRes || !sessionsRes.ok) {
        terminalStore.restoreSessionsError =
          await sessionsRes?.text?.().catch(() => "") || "Failed to fetch existing sessions";
        return;
      }
      terminalStore.hasRestoredTabsFromStorage = true;
      const sessions = await sessionsRes.json();
      if (!Array.isArray(sessions) || sessions.length === 0) return;

      const savedOrder = await terminalStore.loadTabOrder();
      const orderMap = new Map(savedOrder.map((id, i) => [id, i]));
      const sortedSessions = [...sessions].sort((a, b) => {
        const ai = orderMap.get(a.session_id) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderMap.get(b.session_id) ?? Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return (a.created_at || 0) - (b.created_at || 0);
      });

      _reconcileTabs(sortedSessions, await _jobsJson(jobsRes));

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
      const [sessionsRes, jobsRes] = await Promise.all([
        auth.apiFetch(EP_TERMINAL_SESSIONS).catch(() => null),
        auth.apiFetch(EP_JOBS_WORKSPACES).catch(() => null),
      ]);
      if (!sessionsRes || !sessionsRes.ok) return;
      const sessions = await sessionsRes.json();
      if (!Array.isArray(sessions)) return;

      const allJobs = await _jobsJson(jobsRes);
      const serverSessionIds = new Set(sessions.map((s) => s.session_id));

      // サーバから消えたセッションの pendingClose は取り残し（clearPendingClose 漏れ）。
      // 残すとそのセッションのタブを二度と再追加できなくなるためここで自己回復させる。
      for (const id of stalePendingCloseIds(terminalStore.pendingCloseSessionIds, serverSessionIds)) {
        terminalStore.clearPendingClose(id);
      }

      _reconcileTabs(sessions, allJobs);

      for (const tab of [...terminalStore.openTabs]) {
        if (!serverSessionIds.has(tab.sessionId)) {
          disconnectTerminal(tab);
          terminalStore.removeTab(tab.id);
        }
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
