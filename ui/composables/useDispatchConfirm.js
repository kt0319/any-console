import { ref } from "vue";
import { useApi } from "./useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { useDispatchPrompt } from "./useDispatchPrompt.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { dispatchDecisionPath, EP_JOBS_WORKSPACES } from "../utils/endpoints.js";
import { buildSessionTabParams } from "../utils/session-jobs.js";
import { emit } from "../app-bridge.js";

// Settingsの「Dispatch Queue」一覧が表示する承認待ちリクエスト。
// サーバがステータスストリーム WS（type="dispatch_queue"）で配信する全量スナップ
// ショットをそのまま反映する。接続時・キュー変化時の両方で届くため、他端末で
// 決定された項目が残り続けることはない。
/** @type {import("vue").Ref<{id: string, request: Record<string, any>}[]>} */
const queue = ref([]);

function removeFromQueue(id) {
  queue.value = queue.value.filter((q) => q.id !== id);
}

/**
 * ステータスストリームから受信したキュー全量で置き換える。
 * 表示中の承認ダイアログの対象が消えた場合（他端末で決定済み）はダイアログも閉じる。
 * @param {{id: string, request: Record<string, any>}[]} items
 */
export function applyDispatchQueue(items) {
  const ids = new Set(items.map((q) => q.id));
  const removed = queue.value.filter((q) => !ids.has(q.id));
  queue.value = items;
  if (removed.length) {
    const { dismissById } = useDispatchPrompt();
    for (const q of removed) dismissById(q.id);
  }
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

  /**
   * Settingsの「Dispatches」一覧で1件選んだときに呼ぶ。
   * ここで初めてタブ切替・承認ダイアログ表示・決定APIの送信を行う。
   * ダイアログの Cancel は「今は見ない」という意味なので、サーバへは何も送らず
   * キューに残す（削除したい場合は一覧の×ボタン＝rejectItem を使う）。
   * 承認時は決定APIのレスポンスが起動結果を返すため、そのままセッションへ移動する。
   */
  async function resolveItem(id) {
    const item = queue.value.find((q) => q.id === id);
    if (!item) return;
    focusMatchingTab(item.request);
    const { approved, overrides } = await openDispatchPrompt(item.request, id);
    if (!approved) return;
    const { ok, data } = await apiPost(dispatchDecisionPath(id), {
      approved: true,
      ...overrides,
    }, { errorMessage: "Failed to run dispatch (it may have already been decided elsewhere)" });
    if (!ok) return;
    // WS ブロードキャストでも消えるが、切断中でも一覧へ即時反映する。
    removeFromQueue(id);
    focusSession(data?.session_id, data?.workspace);
  }

  /**
   * Settingsの「Dispatches」一覧の×ボタンから呼ぶ。ダイアログを開かず却下する。
   */
  async function rejectItem(id) {
    dismissById(id);
    const { ok } = await apiPost(dispatchDecisionPath(id), { approved: false },
      { errorMessage: "Failed to discard dispatch (it may have already been decided elsewhere)" });
    if (ok) removeFromQueue(id);
  }

  return { queue, resolveItem, rejectItem };
}
