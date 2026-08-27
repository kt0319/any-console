import { ref } from "vue";
import { useApi } from "./useApi.ts";
import { getWithRetry } from "../utils/api-retry.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import {
  dispatchDecisionPath,
  EP_JOBS_WORKSPACES,
  EP_TERMINAL_SESSIONS,
} from "../utils/endpoints.ts";
import { buildSessionTabParamsWithCache } from "./useSessionSync.ts";
import { resolveDispatchJobLabel } from "../utils/dispatch-request.ts";
import { emit, on } from "../app-bridge.ts";

type DispatchQueueItem = { id: string, request: Record<string, any> };
type DispatchRecentItem = DispatchQueueItem & { outcome: string };

// Settingsの「Dispatch Queue」一覧が表示する承認待ちリクエスト。
// サーバがステータスストリーム WS（type="dispatch_queue"）で配信する全量スナップ
// ショットをそのまま反映する。接続時・キュー変化時の両方で届くため、他端末で
// 決定された項目が残り続けることはない。
const queue = ref<DispatchQueueItem[]>([]);

// 実行/破棄が決定された直近の項目（新しい順）。実行しても結果がすぐ
// 消えてしまう問題への対応で、サーバ側が直近N件だけ一時的に
// 残して配信する（outcome: "executed" | "discarded"）。
const recent = ref<DispatchRecentItem[]>([]);

function removeFromQueue(id: string) {
  queue.value = queue.value.filter((q) => q.id !== id);
}

// dispatchピル/一覧でjob idではなく表示用labelを出すためのジョブ定義
// キャッシュ（/jobs/workspaces）。queue/recentと同じくモジュールスコープの
// 単一状態にし、複数コンポーネントから同時にuseDispatchQueue()が呼ばれても
// fetchは1回だけにする。
const allJobs = ref<Record<string, any>>({});
let allJobsLoadPromise: Promise<void> | null = null;

// ジョブ編集で古いキャッシュを引きずらないよう、他のjob一覧系キャッシュ
// （WorkspaceJobsPane.vue）と同じ jobs:refresh で無効化する。
on("jobs:refresh", () => {
  allJobsLoadPromise = null;
});

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

export function useDispatchQueue() {
  const { apiPost, apiGet } = useApi();
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();

  function loadAllJobs(): Promise<void> {
    if (!allJobsLoadPromise) {
      allJobsLoadPromise = (async () => {
        const res = await getWithRetry(apiGet, EP_JOBS_WORKSPACES);
        if (res.ok && res.data) allJobs.value = res.data;
      })();
    }
    return allJobsLoadPromise;
  }
  // dispatchピル・Dispatch Queue一覧のどちらもマウント時点でjob labelが
  // 引ければ十分なため fire-and-forget（結果は allJobs の更新で反映され、
  // 呼び出し側のcomputedが自動で追従する）。
  loadAllJobs();

  function jobLabel(request: Record<string, any>): string {
    return resolveDispatchJobLabel(request, allJobs.value);
  }

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
   * DispatchRunView の Run から呼ぶ。pendingのitemでも、既に決定済みで履歴
   * （recent）に残っているだけのitemでも同じエンドポイントで実行できる
   * （サーバ側 dispatch_execute が dispatch_id の所在を見て振り分ける）。
   * レスポンスが起動結果を返すため、成功時はそのままセッションへ移動する。
   * @returns 実行できたか
   */
  async function runItem(id: string, overrides: Record<string, any>): Promise<boolean> {
    const { ok, data } = await apiPost(dispatchDecisionPath(id), {
      executed: true,
      ...overrides,
    }, { errorMessage: "Failed to run dispatch" });
    if (!ok) return false;
    // WS ブロードキャストでも消えるが、切断中でも一覧へ即時反映する。
    removeFromQueue(id);
    // await必須（Codexレビュー指摘: fire-and-forgetだと、呼び出し元がrunItem完了
    // 直後にモーダルを閉じる等で先に進んだ場合、新規セッションのタブ作成/WS接続が
    // 完了する前に処理が終わり、pending text（TMUX_PENDING_TEXT）を流すサーバ側の
    // flush_pending_textが呼ばれずコマンドが入力されないことがあった）。
    await focusSession(data?.session_id, data?.workspace);
    return true;
  }

  /**
   * DispatchRunView / 一覧の×ボタンから呼ぶ。pendingのitemのみ対象
   * （既に決定済みのitemを破棄することはできない）。
   * @returns 破棄できたか
   */
  async function rejectItem(id: string): Promise<boolean> {
    const { ok } = await apiPost(dispatchDecisionPath(id), { executed: false },
      { errorMessage: "Failed to discard dispatch (it may have already been decided elsewhere)" });
    if (ok) removeFromQueue(id);
    return ok;
  }

  return { queue, recent, runItem, rejectItem, jobLabel, allJobs };
}
