import { ref } from "vue";
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

// Settingsの「Dispatches」一覧が表示する保留中リクエスト。
// pending 受信時点ではダイアログを開かず、ここに積むだけにする
// （作業中に強制的にタブを切り替えられるのを避けるため）。
/** @type {import("vue").Ref<{id: string, request: object}[]>} */
const queue = ref([]);

function removeFromQueue(id) {
  queue.value = queue.value.filter((q) => q.id !== id);
}

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

  function handlePending(payload) {
    if (!payload?.id || handled.has(payload.id)) return;
    handled.add(payload.id);
    queue.value = [...queue.value, { id: payload.id, request: payload.request || {} }];
  }

  /**
   * Settingsの「Dispatches」一覧で1件選んだときに呼ぶ。
   * ここで初めてタブ切替・承認ダイアログ表示・決定APIの送信を行う。
   * ダイアログの Cancel は「今は見ない」という意味なので、サーバへは何も送らず
   * キューに戻す（削除したい場合は一覧の×ボタン＝rejectItem を使う）。
   */
  async function resolveItem(id) {
    const item = queue.value.find((q) => q.id === id);
    if (!item) return;
    removeFromQueue(id);
    focusMatchingTab(item.request);
    const { approved, overrides } = await openDispatchPrompt(item.request, id);
    if (!approved) {
      queue.value = [...queue.value, item];
      return;
    }
    approvedIds.add(id);
    await apiPost(`/dispatch/${encodeURIComponent(id)}/decision`, {
      approved: true,
      ...overrides,
    }, { errorMessage: "Failed to run dispatch (it may have already been decided elsewhere)" });
  }

  /**
   * Settingsの「Dispatches」一覧の×ボタンから呼ぶ。ダイアログを開かず却下する。
   */
  async function rejectItem(id) {
    const item = queue.value.find((q) => q.id === id);
    if (!item) return;
    removeFromQueue(id);
    dismissById(id);
    await apiPost(`/dispatch/${encodeURIComponent(id)}/decision`, { approved: false },
      { errorMessage: "Failed to discard dispatch (it may have already been decided elsewhere)" });
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
      else if (payload.type === "result" || payload.type === "decided") {
        // 承認/却下どちらも、この端末が起点でなくても一覧から消す
        // （別端末で先に決定された項目が残り続けて404を踏むのを防ぐため）。
        handled.add(payload.id);
        removeFromQueue(payload.id);
        dismissById(payload.id);
        if (payload.type === "result") handleResult(payload);
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

  return { start, queue, resolveItem, rejectItem };
}
