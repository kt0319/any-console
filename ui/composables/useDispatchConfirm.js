import { ref } from "vue";
import { useApi } from "./useApi.js";
import { getWithRetry } from "../utils/api-retry.js";
import { useTerminalStore } from "../stores/terminal.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import {
  dispatchDecisionPath,
  dispatchRerunPath,
  EP_JOBS_WORKSPACES,
  EP_TERMINAL_SESSIONS,
} from "../utils/endpoints.js";
import { buildSessionTabParamsWithCache } from "./useSessionSync.js";
import { emit } from "../app-bridge.js";

// Settingsの「Dispatch Queue」一覧が表示する承認待ちリクエスト。
// サーバがステータスストリーム WS（type="dispatch_queue"）で配信する全量スナップ
// ショットをそのまま反映する。接続時・キュー変化時の両方で届くため、他端末で
// 決定された項目が残り続けることはない。
/** @type {import("vue").Ref<{id: string, request: Record<string, any>}[]>} */
const queue = ref([]);

// 承認/却下が決定された直近の項目（新しい順）。承認しても実行されたことが
// 分からずすぐ消えてしまう問題への対応で、サーバ側が直近N件だけ一時的に
// 残して配信する（decision: "approved" | "rejected"）。
/** @type {import("vue").Ref<{id: string, request: Record<string, any>, decision: string}[]>} */
const recent = ref([]);

function removeFromQueue(id) {
  queue.value = queue.value.filter((q) => q.id !== id);
}

/**
 * ステータスストリームから受信したキュー全量で置き換える。
 * DispatchRunView を開いたまま対象が消えた場合（他端末で決定済み）に一覧へ
 * 戻れるよう、消えた項目IDを dispatch:itemRemoved で通知する。
 * @param {{id: string, request: Record<string, any>}[]} items
 * @param {{id: string, request: Record<string, any>, decision: string}[]} [recentItems]
 */
export function applyDispatchQueue(items, recentItems) {
  const ids = new Set(items.map((q) => q.id));
  const removed = queue.value.filter((q) => !ids.has(q.id));
  queue.value = items;
  recent.value = recentItems || [];
  for (const q of removed) emit("dispatch:itemRemoved", { id: q.id });
}

export function useDispatchConfirm() {
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
      getWithRetry(apiGet, EP_TERMINAL_SESSIONS),
      getWithRetry(apiGet, EP_JOBS_WORKSPACES),
    ]);
    if (!sessionsRes.ok || !Array.isArray(sessionsRes.data)) return;
    const meta = sessionsRes.data.find((s) => s.session_id === sessionId);
    if (!meta) return;
    if (workspace) workspaceStore.selectedWorkspace = workspace;
    const allJobs = jobsRes.ok && jobsRes.data ? jobsRes.data : {};
    const tab = terminalStore.addTerminalTab({
      ...buildSessionTabParamsWithCache(meta, { workspaces: workspaceStore.allWorkspaces, allJobs }),
      restored: false,
    });
    emit("tab:select", { tab });
  }

  /**
   * DispatchRunView の Run から呼ぶ。決定APIのレスポンスが起動結果を返すため、
   * 成功時はそのままセッションへ移動する。
   * @param {string} id
   * @param {Record<string, any>} overrides
   * @returns {Promise<boolean>} 実行できたか
   */
  async function runItem(id, overrides) {
    const { ok, data } = await apiPost(dispatchDecisionPath(id), {
      approved: true,
      ...overrides,
    }, { errorMessage: "Failed to run dispatch (it may have already been decided elsewhere)" });
    if (!ok) return false;
    // WS ブロードキャストでも消えるが、切断中でも一覧へ即時反映する。
    removeFromQueue(id);
    focusSession(data?.session_id, data?.workspace);
    return true;
  }

  /**
   * DispatchRunView / 一覧の×ボタンから呼ぶ。
   * @param {string} id
   * @returns {Promise<boolean>} 破棄できたか
   */
  async function rejectItem(id) {
    const { ok } = await apiPost(dispatchDecisionPath(id), { approved: false },
      { errorMessage: "Failed to discard dispatch (it may have already been decided elsewhere)" });
    if (ok) removeFromQueue(id);
    return ok;
  }

  /**
   * 一覧の「Recently executed」から呼ぶ。同じ内容で新規に承認待ちキューへ
   * 積み直す（サーバ側は元のdispatch_idではなく新しいIDを発行する。実行済み
   * セッションID等の当時のスナップショットは引き継がず、通常のdispatchと
   * 同じ経路で既存セッション探索・dedup判定をやり直す）。承認待ちに積むだけで
   * 即実行はしないため、キュー一覧側で改めてRun/Discardする。
   * @param {string} id
   * @returns {Promise<boolean>} 積み直せたか
   */
  async function rerunItem(id) {
    const { ok } = await apiPost(dispatchRerunPath(id), {}, {
      errorMessage: "Failed to rerun dispatch (it may no longer be in recent history)",
    });
    return ok;
  }

  /**
   * DispatchRunView（Recently executedから開いた場合）のRunから呼ぶ。
   * モーダルで内容を確認・編集済みのため、承認キューを経由せず上書き後の
   * 内容でその場で再実行する（run: true）。レスポンスが起動結果を返すため、
   * 成功時はそのままセッションへ移動する。
   * @param {string} id
   * @param {Record<string, any>} overrides
   * @returns {Promise<boolean>} 実行できたか
   */
  async function rerunNow(id, overrides) {
    const { ok, data } = await apiPost(dispatchRerunPath(id), { run: true, ...overrides }, {
      errorMessage: "Failed to rerun dispatch (it may no longer be in recent history)",
    });
    if (!ok) return false;
    focusSession(data?.session_id, data?.workspace);
    return true;
  }

  return { queue, recent, runItem, rejectItem, rerunItem, rerunNow };
}
