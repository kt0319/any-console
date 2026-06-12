import { useConfirm } from "./useConfirm.js";
import { useApi } from "./useApi.js";

const RECONNECT_DELAY_MS = 3000;
const handled = new Set();
let started = false;
let es = null;

function summarizePrompt(text) {
  if (!text) return "(no input)";
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

function branchNote(req) {
  if (!req.branch) return "";
  if (req.branch_status === "current") return " (already current)";
  if (req.branch_status === "exists") return " (checkout)";
  if (req.branch_status === "missing") return req.create_branch ? " (new branch)" : " (does not exist — will fail)";
  return req.create_branch ? " (create if missing)" : "";
}

function buildMessage(req) {
  const lines = [];
  lines.push(`Workspace: ${req.workspace}`);
  if (req.job && req.job !== "terminal") lines.push(`Job: ${req.job}`);
  if (req.branch) lines.push(`Branch: ${req.branch}${branchNote(req)}`);
  if (req.text) lines.push(`Input: ${summarizePrompt(req.text)}`);
  return `Run dispatch?\n\n${lines.join("\n")}`;
}

export function useDispatchConfirm() {
  const { confirm } = useConfirm();
  const { apiPost } = useApi();

  async function handlePending(payload) {
    if (!payload?.id || handled.has(payload.id)) return;
    handled.add(payload.id);
    const approved = await confirm(buildMessage(payload.request || {}), {
      ok: { label: "Run", icon: "mdi-play" },
    });
    try {
      await apiPost(`/dispatch/${encodeURIComponent(payload.id)}/decision`, { approved: !!approved });
    } catch {}
  }

  function connect() {
    if (typeof EventSource === "undefined") return;
    es = new EventSource("/dispatch/events");
    es.onmessage = (e) => {
      let payload;
      try { payload = JSON.parse(e.data); } catch { return; }
      if (payload.type === "pending") handlePending(payload);
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
