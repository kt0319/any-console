import { useApi } from "./useApi.js";
import { useDispatchPrompt } from "./useDispatchPrompt.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { emit } from "../app-bridge.js";

const RECONNECT_DELAY_MS = 3000;
const handled = new Set();
const approvedIds = new Set();
let started = false;
let es = null;

export function useDispatchConfirm() {
  const { open: openDispatchPrompt } = useDispatchPrompt();
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
    });
    emit("tab:select", { tab });
  }

  function focusMatchingTab(req) {
    if (!req?.workspace) return;
    // dispatch の match=any 仕様に合わせて、workspace 一致タブがあれば即アクティブにする。
    // ユーザがダイアログを見た時点で「どのタブに入力が流れるか」を視認できるようにする。
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
    const { approved, overrides } = await openDispatchPrompt(payload.request || {});
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
