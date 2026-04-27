import { useAuthStore } from "../stores/auth.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useTerminal } from "./useTerminal.js";
import { LAYOUT_FIT_DELAY_MS, LS_KEY_ACTIVE_SESSION } from "../utils/constants.js";
import { EP_TERMINAL_SESSIONS, EP_JOBS_WORKSPACES } from "../utils/endpoints.js";
import { emit } from "../app-bridge.js";

export function useSessionSync() {
  const auth = useAuthStore();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const { disconnectTerminal } = useTerminal();

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
      hidden: !!jobDef?.hidden_tab,
    };
  }

  async function _fetchAllJobs(jobsRes) {
    try {
      if (jobsRes && jobsRes.ok) return await jobsRes.json();
    } catch {}
    return {};
  }

  async function restoreExistingSessions(sessionsRes, jobsRes) {
    if (terminalStore.hasRestoredTabsFromStorage) return;
    terminalStore.hasRestoredTabsFromStorage = true;
    terminalStore.restoreSessionsLoading = true;
    terminalStore.restoreSessionsError = "";
    try {
      if (!sessionsRes || !sessionsRes.ok) {
        if (sessionsRes) {
          let detail = "Failed to fetch existing sessions";
          try {
            const text = await sessionsRes.text?.();
            if (text) detail = text;
          } catch {}
          terminalStore.restoreSessionsError = detail;
        }
        return;
      }
      const sessions = await sessionsRes.json();
      if (!Array.isArray(sessions) || sessions.length === 0) return;

      const allJobs = await _fetchAllJobs(jobsRes);
      for (const s of sessions) {
        terminalStore.addTerminalTab(_buildTabParams(s, allJobs));
      }

      const savedSessionId = localStorage.getItem(LS_KEY_ACTIVE_SESSION);
      const visibleTabs = terminalStore.openTabs.filter((t) => !t.hidden);
      const target = (savedSessionId && visibleTabs.find((t) => t.sessionId === savedSessionId))
        || visibleTabs[0]
        || terminalStore.openTabs[0];
      if (target) terminalStore.switchTab(target.id);
      setTimeout(() => emit("layout:fitAll", { force: true }), LAYOUT_FIT_DELAY_MS);
    } catch (e) {
      console.error("restoreExistingSessions failed:", e);
      terminalStore.restoreSessionsError = e?.message || "Error restoring existing sessions";
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

      const allJobs = await _fetchAllJobs(jobsRes);
      const serverSessionIds = new Set(sessions.map((s) => s.session_id));
      const localSessionIds = new Set(terminalStore.openTabs.map((t) => t.sessionId));

      for (const s of sessions) {
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

  const SYNC_INTERVAL_MS = 5000;
  let syncIntervalId = null;

  function startSyncPolling() {
    stopSyncPolling();
    syncIntervalId = setInterval(() => syncSessionsFromServer(), SYNC_INTERVAL_MS);
  }

  function stopSyncPolling() {
    if (syncIntervalId != null) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
  }

  return { restoreExistingSessions, syncSessionsFromServer, startSyncPolling, stopSyncPolling };
}
