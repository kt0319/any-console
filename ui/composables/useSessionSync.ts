import { useAuthStore } from "../stores/auth.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useTerminal } from "./useTerminal.ts";
import { useSplitLayoutPersist } from "./useSplitLayoutPersist.ts";
import { LAYOUT_FIT_DELAY_MS, LS_KEY_ACTIVE_SESSION, SESSION_SYNC_INTERVAL_MS, NEW_TAB_SYNC_GRACE_MS } from "../utils/constants.ts";
import { safeStringLoad } from "../utils/storage.ts";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES } from "../utils/endpoints.ts";
import { loadAllJobs, loadSessionsResponse, buildSessionTabParams, applyCachedJobIcon, isJobDefResolved } from "../utils/session-jobs.ts";
import { emit } from "../app-bridge.ts";

// セッション再生成時に allJobs が不完全で mdi-play に落ちないよう、解決済みジョブアイコンを保持する
const resolvedJobIcons = new Map<string, { icon: string, iconColor: string | null }>();

// 呼び出し側は mdi-play フォールバック適用前の生のジョブアイコンを渡すこと
export function rememberJobIcon(sessionId: string, icon: string, iconColor?: string | null) {
  if (!sessionId || !icon) return;
  resolvedJobIcons.set(sessionId, { icon, iconColor: iconColor || null });
}

// buildSessionTabParams を直接呼ぶ経路ではこちらを使う（mdi-play 固定化の穴を作らないため）
export function buildSessionTabParamsWithCache(
  session: Parameters<typeof buildSessionTabParams>[0] & { session_id: string },
  opts: { workspaces?: Array<Record<string, any>>, allJobs: Record<string, any> },
) {
  const built = buildSessionTabParams(session, opts);
  return applyCachedJobIcon(built, isJobDefResolved(session, opts.allJobs), session, resolvedJobIcons);
}

export function useSessionSync() {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const layoutStore = useLayoutStore();
  const { disconnectTerminal } = useTerminal();
  const { restoreLayout } = useSplitLayoutPersist();

  function _buildTabParams(s: Parameters<typeof buildSessionTabParamsWithCache>[0], allJobs: Record<string, any>) {
    return { ...buildSessionTabParamsWithCache(s, { workspaces: workspaceStore.allWorkspaces, allJobs }), restored: true };
  }

  // dispatch が作る worktree はワークスペース一覧に未登録のため、タブ作成前に取り込む
  async function _refreshWorkspacesForUnknown(sessions: { workspace?: string | null }[]) {
    const known = new Set(workspaceStore.allWorkspaces.map((w) => w.name));
    if (sessions.some((s) => s.workspace && !known.has(s.workspace))) await workspaceStore.fetchWorkspaces();
  }

  async function _safeResJson(res: Response | null) {
    try {
      if (res && res.ok) return await res.json();
    } catch {}
    return {};
  }

  // allJobs が空のまま焼き込むとアイコンが mdi-play に固定されるため、空なら 1 回だけ再取得する
  function _loadAllJobs(jobsRes: Response | null, sessions: { job_name?: string | null }[]) {
    return loadAllJobs(jobsRes, sessions, {
      readJson: _safeResJson,
      refetch: () => auth.apiFetch(EP_JOBS_WORKSPACES).catch(() => null),
    });
  }

  function _loadSessions(sessionsRes: Response | null) {
    return loadSessionsResponse(sessionsRes, {
      refetch: () => auth.apiFetch(EP_TERMINAL_SESSIONS).catch(() => null),
    });
  }

  async function restoreExistingSessions(sessionsRes: Response | null, jobsRes: Response | null) {
    if (terminalStore.hasRestoredSessions) return;
    terminalStore.restoreSessionsLoading = true;
    terminalStore.restoreSessionsError = "";
    try {
      // 失敗を握りつぶすとタブ 0 件で確定するため再取得する。成功時だけ「復元済み」にする
      const res = await _loadSessions(sessionsRes);
      if (!res || !res.ok) {
        if (res) {
          terminalStore.restoreSessionsError = await res.text?.().catch(() => "") || "Failed to fetch existing sessions";
        }
        return;
      }
      terminalStore.hasRestoredSessions = true;
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
        const savedSessionId = safeStringLoad(LS_KEY_ACTIVE_SESSION);
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
      // 未知のセッションがある時だけ /jobs/workspaces を叩く（毎ポーリングの common jobs マージを避ける）
      const newSessions = sessions.filter((s) =>
        !s.detached && !terminalStore.pendingCloseSessionIds.has(s.session_id) && !localSessionIds.has(s.session_id),
      );

      if (newSessions.length) {
        const allJobs = await _loadAllJobs(null, newSessions);
        await _refreshWorkspacesForUnknown(newSessions);
        for (const s of newSessions) {
          const tab = terminalStore.addTerminalTab({ ..._buildTabParams(s, allJobs), adjacent: true });
          // interactive=false（外部ツールの /run 直叩き等）のセッションだけタブバーから隠す
          if (!s.interactive) terminalStore.setTabFlag(tab.id, "autoDiscovered", true);
        }
      }

      for (const tab of [...terminalStore.openTabs]) {
        if (serverSessionIds.has(tab.sessionId)) continue;
        // 作成直後のタブはサーバ反映前にポーリングが発行された可能性があるため、猶予期間内は除去しない
        if (Date.now() - tab._createdAt < NEW_TAB_SYNC_GRACE_MS) continue;
        disconnectTerminal(tab);
        terminalStore.removeTab(tab.id);
      }
    } catch (e) {
      console.error("syncSessionsFromServer failed:", e);
    }
  }

  let syncIntervalId: ReturnType<typeof setInterval> | null = null;

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
