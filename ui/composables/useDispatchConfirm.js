import { useConfirm } from "./useConfirm.js";
import { useApi } from "./useApi.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";
import { buildActionSummary } from "../utils/actionSummary.js";

const RECONNECT_DELAY_MS = 3000;
const handled = new Set();
const approvedIds = new Set();
let started = false;
let es = null;

function buildMessage(req) {
  return buildActionSummary({
    title: "Run dispatch?",
    workspace: req.workspace,
    job: req.job,
    branch: req.branch,
    branchStatus: req.branch_status,
    createBranch: req.create_branch,
    baseBranch: req.base_branch,
    text: req.text,
  });
}

export function useDispatchConfirm() {
  const { confirm } = useConfirm();
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
    const { ok, data } = await apiGet("/terminal/sessions");
    if (!ok || !Array.isArray(data)) return;
    const meta = data.find((s) => s.session_id === sessionId);
    if (!meta) return;
    if (workspace) workspaceStore.selectedWorkspace = workspace;
    const tab = terminalStore.addTerminalTab({
      wsUrl: meta.ws_url,
      workspace: meta.workspace,
      wsIcon: meta.icon,
      wsIconColor: meta.icon_color,
      icon: meta.job_name ? (meta.icon || "mdi-play") : "mdi-console",
      iconColor: meta.icon_color,
      jobName: meta.job_name,
      jobLabel: meta.job_label,
      restored: false,
      hidden: false,
    });
    emit("tab:select", { tab });
  }

  async function handlePending(payload) {
    if (!payload?.id || handled.has(payload.id)) return;
    handled.add(payload.id);
    const approved = await confirm(buildMessage(payload.request || {}), {
      ok: { label: "Run", icon: "mdi-play" },
    });
    if (approved) approvedIds.add(payload.id);
    try {
      await apiPost(`/dispatch/${encodeURIComponent(payload.id)}/decision`, { approved: !!approved });
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
      else if (payload.type === "expired" || payload.type === "decided") handled.add(payload.id);
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
