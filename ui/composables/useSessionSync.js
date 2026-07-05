import { useAuthStore } from "../stores/auth.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLayoutStore } from "../stores/layout.js";
import { useTerminal } from "./useTerminal.js";
import { useLayoutPersist } from "./useLayoutPersist.js";
import { LAYOUT_FIT_DELAY_MS, LS_KEY_ACTIVE_SESSION, SESSION_SYNC_INTERVAL_MS } from "../utils/constants.js";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES } from "../utils/endpoints.js";
import { loadAllJobs, loadSessionsResponse } from "../utils/session-jobs.js";
import { emit } from "../app-bridge.js";

export function useSessionSync() {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const layoutStore = useLayoutStore();
  const { disconnectTerminal } = useTerminal();
  const { restoreLayout } = useLayoutPersist();

  function _buildTabParams(s, allJobs) {
    const ws = workspaceStore.allWorkspaces.find((w) => w.name === s.workspace);
    const jobDef = s.job_name && s.workspace ? allJobs[s.workspace]?.[s.job_name] : null;
    return {
      wsUrl: s.ws_url,
      workspace: s.workspace,
      wsIcon: ws?.icon || s.icon || null,
      wsIconColor: ws?.icon_color || s.icon_color,
      icon: s.job_name ? (jobDef?.icon || "mdi-play") : "mdi-console",
      iconColor: jobDef?.icon_color,
      jobName: s.job_name,
      jobLabel: s.job_label,
      restored: true,
    };
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
      const [sessionsRes, jobsRes] = await Promise.all([
        auth.apiFetch(EP_TERMINAL_SESSIONS).catch(() => null),
        auth.apiFetch(EP_JOBS_WORKSPACES).catch(() => null),
      ]);
      if (!sessionsRes || !sessionsRes.ok) return;
      const sessions = await sessionsRes.json();
      if (!Array.isArray(sessions)) return;

      const allJobs = await _loadAllJobs(jobsRes, sessions);
      const serverSessionIds = new Set(sessions.map((s) => s.session_id));
      const localSessionIds = new Set(terminalStore.openTabs.map((t) => t.sessionId));

      for (const s of sessions) {
        if (s.detached) continue;
        if (!localSessionIds.has(s.session_id)) {
          terminalStore.addTerminalTab(_buildTabParams(s, allJobs));
        }
      }

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
