import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import {
  dispatchDecisionPath,
  dispatchRerunPath,
  EP_JOBS_WORKSPACES,
  EP_TERMINAL_SESSIONS,
} from "../utils/endpoints.ts";
import { buildSessionTabParamsWithCache } from "./useSessionSync.ts";
import { emit } from "../app-bridge.js";

type DispatchQueueItem = { id: string, request: Record<string, any> };
type DispatchRecentItem = DispatchQueueItem & { decision: string };

// Settingsの「Dispatch Queue」一覧が表示する承認待ちリクエスト。
// サーバがステータスストリーム WS（type="dispatch_queue"）で配信する全量スナップ
// ショットをそのまま反映する。接続時・キュー変化時の両方で届くため、他端末で
// 決定された項目が残り続けることはない。
const queue = ref<DispatchQueueItem[]>([]);

// 承認/却下が決定された直近の項目（新しい順）。承認しても実行されたことが
// 分からずすぐ消えてしまう問題への対応で、サーバ側が直近N件だけ一時的に
// 残して配信する（decision: "approved" | "rejected"）。
const recent = ref<DispatchRecentItem[]>([]);

function removeFromQueue(id: string) {
  queue.value = queue.value.filter((q) => q.id !== id);
}

/**
 * ステータスストリームから受信したキュー全量で置き換える。
 * DispatchRunView を開いたまま対象が消えた場合（他端末で決定済み）に一覧へ
 * 戻れるよう、消えた項目IDを dispatch:itemRemoved で通知する。
 */
export function applyDispatchQueue(items: DispatchQueueItem[], recentItems?: DispatchRecentItem[]) {
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

  async function focusSession(sessionId?: string, workspace?: string) {
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
   * @returns 実行できたか
   */
  async function runItem(id: string, overrides: Record<string, any>): Promise<boolean> {
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
   * @returns 破棄できたか
   */
  async function rejectItem(id: string): Promise<boolean> {
    const { ok } = await apiPost(dispatchDecisionPath(id), { approved: false },
      { errorMessage: "Failed to discard dispatch (it may have already been decided elsewhere)" });
    if (ok) removeFromQueue(id);
    return ok;
  }

  /**
   * DispatchRunView（Recently executedから開いた場合）のRunから呼ぶ。
   * モーダルで内容を確認・編集済みのため、承認キューを経由せず上書き後の
   * 内容でその場で再実行する（run: true）。レスポンスが起動結果を返すため、
   * 成功時はそのままセッションへ移動する。
   * @returns 実行できたか
   */
  async function rerunNow(id: string, overrides: Record<string, any>): Promise<boolean> {
    const { ok, data } = await apiPost(dispatchRerunPath(id), { run: true, ...overrides }, {
      errorMessage: "Failed to rerun dispatch (it may no longer be in recent history)",
    });
    if (!ok) return false;
    focusSession(data?.session_id, data?.workspace);
    return true;
  }

  return { queue, recent, runItem, rejectItem, rerunNow };
}
