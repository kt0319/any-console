import { useApi } from "./useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { useDispatchPrompt } from "./useDispatchPrompt.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { EP_JOBS_WORKSPACES } from "../utils/endpoints.js";
import { buildSessionTabParams } from "../utils/session-jobs.js";
import { emit } from "../app-bridge.js";

const RECONNECT_DELAY_MS = 3000;
const handled = new Set();
const approvedIds = new Set();
let started = false;
let es = null;

export function useDispatchConfirm() {
  const { open: openDispatchPrompt, dismissById } = useDispatchPrompt();
  const { apiPost, apiGet } = useApi();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();

  async function focusSession(sessionId, workspace) {
    if (!sessionId) return;
    const existing = terminalStore.openTabs.find((t) => t.sessionId === sessionId);
    if (existing) {
      emit("tab:select", { tab: existing });
      return;
    }
    const [sessionsRes, jobsRes] = await Promise.all([
      getWithRetry(apiGet, "/terminal/sessions"),
      getWithRetry(apiGet, EP_JOBS_WORKSPACES),
    ]);
    if (!sessionsRes.ok || !Array.isArray(sessionsRes.data)) return;
    const meta = sessionsRes.data.find((s) => s.session_id === sessionId);
    if (!meta) return;
    if (workspace) workspaceStore.selectedWorkspace = workspace;
    const allJobs = jobsRes.ok && jobsRes.data ? jobsRes.data : {};
    const tab = terminalStore.addTerminalTab({
      ...buildSessionTabParams(meta, { workspaces: workspaceStore.allWorkspaces, allJobs }),
      restored: false,
    });
    emit("tab:select", { tab });
  }

  function focusMatchingTab(req) {
    if (!req?.workspace) return;
    // existing_session_id があればそのタブを優先してアクティブにする。
    if (req.existing_session_id) {
      const sessionTab = terminalStore.openTabs.find((t) => t.sessionId === req.existing_session_id);
      if (sessionTab) { emit("tab:select", { tab: sessionTab }); return; }
    }
    const effectiveWs = req.effective_workspace || req.workspace;
    const candidates = terminalStore.openTabs.filter((t) => t.workspace === effectiveWs);
    if (!candidates.length) return;
    const target = candidates.find((t) => t.id === terminalStore.activeTabId) || candidates[0];
    emit("tab:select", { tab: target });
  }

  async function handlePending(payload) {
    if (!payload?.id || handled.has(payload.id)) return;
    handled.add(payload.id);
    focusMatchingTab(payload.request || {});
    const { approved, overrides } = await openDispatchPrompt(payload.request || {}, payload.id);
    if (approved) approvedIds.add(payload.id);
    try {
      await apiPost(`/dispatch/${encodeURIComponent(payload.id)}/decision`, {
        approved: !!approved,
        ...(approved ? overrides : {}),
      });
    } catch {}
  }

  function handleResult(payload) {
    if (!payload?.id || !approvedIds.has(payload.id)) return;
    approvedIds.delete(payload.id);
    focusSession(payload.session_id, payload.workspace);
  }

  function connect() {
    if (typeof EventSource === "undefined") return;
    es = new EventSource("/dispatch/events");
    es.onmessage = (e) => {
      let payload;
      try { payload = JSON.parse(e.data); } catch { return; }
      if (payload.type === "pending") handlePending(payload);
      else if (payload.type === "result") handleResult(payload);
      else if (payload.type === "expired" || payload.type === "decided") {
        handled.add(payload.id);
        dismissById(payload.id);
      }
    };
    es.onerror = () => {
      try { es?.close(); } catch {}
      es = null;
      setTimeout(connect, RECONNECT_DELAY_MS);
    };
  }

  function start() {
    if (started) return;
    started = true;
    connect();
  }

  return { start };
}
