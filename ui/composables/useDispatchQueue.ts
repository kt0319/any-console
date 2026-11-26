import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { useConfirm } from "./useConfirm.ts";
import { useToast } from "./useToast.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import {
  dispatchDecisionPath,
  EP_JOBS_WORKSPACES,
} from "../utils/endpoints.ts";
import { useSessionTabAttach } from "./useSessionTabAttach.ts";
import { resolveDispatchJobLabel } from "../utils/dispatch-request.ts";
import { emit, on } from "../app-bridge.ts";

type DispatchQueueItem = { id: string, request: Record<string, any> };
type DispatchRecentItem = DispatchQueueItem & {
  outcome: string,
  auth?: string,
  session_id?: string,
};

// サーバが WS（type="dispatch_queue"）で配信する承認待ちの全量スナップショット。
const queue = ref<DispatchQueueItem[]>([]);

// 直近に実行/破棄/失敗した項目（新しい順）。サーバが直近N件だけ残して配信する。failed は履歴から再実行できる。
const recent = ref<DispatchRecentItem[]>([]);

function removeFromQueue(id: string) {
  queue.value = queue.value.filter((q) => q.id !== id);
}

// dispatch ピル/一覧で job id ではなく label を出すためのジョブ定義キャッシュ（/jobs/workspaces）。
// モジュール単一状態にして fetch を1回にする。
const allJobs = ref<Record<string, any>>({});
let allJobsLoadPromise: Promise<void> | null = null;

// 他の job 一覧系キャッシュと同じく jobs:refresh で無効化する。
on("jobs:refresh", () => {
  allJobsLoadPromise = null;
});

// 全量で置き換える。他端末で決定され消えた項目IDは dispatch:itemRemoved で通知する（DispatchRunView を一覧へ戻すため）。
export function applyDispatchQueue(items: DispatchQueueItem[], recentItems?: DispatchRecentItem[]) {
  const ids = new Set(items.map((q) => q.id));
  const removed = queue.value.filter((q) => !ids.has(q.id));
  queue.value = items;
  recent.value = recentItems || [];
  for (const q of removed) emit("dispatch:itemRemoved", { id: q.id });
}

export function useDispatchQueue() {
  const { apiPost, apiGet } = useApi();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { attachSessionTab } = useSessionTabAttach();

  function loadAllJobs(): Promise<void> {
    if (!allJobsLoadPromise) {
      allJobsLoadPromise = (async () => {
        const res = await getWithRetry(apiGet, EP_JOBS_WORKSPACES);
        if (res.ok && res.data) allJobs.value = res.data;
      })();
    }
    return allJobsLoadPromise;
  }
  // マウント時点で label が引ければ十分なため fire-and-forget。
  loadAllJobs();

  function jobLabel(request: Record<string, any>): string {
    return resolveDispatchJobLabel(request, allJobs.value);
  }

  async function focusSession(sessionId?: string, workspace?: string) {
    if (!sessionId) return;
    await attachSessionTab(sessionId, { restored: false, workspace });
  }

  // pending でも履歴（recent）の決定済み項目でも同じエンドポイントで実行できる（サーバ dispatch_decide が振り分ける）。
  async function runItem(id: string, overrides: Record<string, any>): Promise<boolean> {
    const { ok, data } = await apiPost(dispatchDecisionPath(id), {
      executed: true,
      ...overrides,
    }, { errorMessage: "Failed to run dispatch" });
    if (!ok) return false;
    // WS ブロードキャストでも消えるが、切断中でも一覧へ即時反映する。
    removeFromQueue(id);
    // await 必須: fire-and-forget だと新規セッションの WS 接続前に処理が終わり、flush_pending_text が呼ばれずコマンドが入力されないことがある。
    await focusSession(data?.session_id, data?.workspace);
    return true;
  }

  // pending の item のみ対象。
  async function rejectItem(id: string): Promise<boolean> {
    const { ok } = await apiPost(dispatchDecisionPath(id), { executed: false },
      { errorMessage: "Failed to discard dispatch (it may have already been decided elsewhere)" });
    if (ok) removeFromQueue(id);
    return ok;
  }

  async function discardItem(id: string, label: string): Promise<boolean> {
    if (!await confirm(`Discard dispatch for "${label}"? This cannot be undone.`)) return false;
    const ok = await rejectItem(id);
    if (ok) toast.success(`Dispatch discarded (${label})`);
    return ok;
  }

  return { queue, recent, runItem, rejectItem, discardItem, jobLabel, allJobs };
}
