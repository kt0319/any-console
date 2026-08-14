import { reactive } from "vue";
import { useApi } from "./useApi.ts";
import { useConfirm } from "./useConfirm.ts";
import { EP_SYSTEM_PROCESS_KILL } from "../utils/endpoints.ts";
import { DEV_SERVER_KILL_POLL_INTERVAL_MS, DEV_SERVER_KILL_POLL_TIMEOUT_MS } from "../utils/constants.ts";

// プロセスkill（SIGTERM）ボタンの共通ロジック。SessionPreviewTab.vue
// （Dev Server一覧）とServerInfo.vue（System Info > Processes）の両方で使う。
// killingPidsはコンポーネントごとに独立させる（別画面のボタンまで巻き込んで
// disabledにしないため、呼び出し側でuseProcessKill()を毎回呼ぶ）。
export function useProcessKill() {
  const { apiPost } = useApi();
  const { confirm } = useConfirm();
  const killingPids = reactive(new Set<number>());

  /**
   * @param pid 対象プロセスのpid
   * @param confirmMessage 確認ダイアログの文言
   * @param refetch kill後に一覧を再取得する関数。呼ぶたびに最新状態を反映する
   *   （戻り値未使用）。省略時は再取得せず即座にkillingPidsから外す。
   * @param isGone refetch後、対象プロセスが一覧から消えたかどうか。
   *   trueになるかタイムアウトするまでrefetchを繰り返す。
   */
  async function killProcess(pid: number, {
    confirmMessage,
    refetch,
    isGone,
  }: {
    confirmMessage: string,
    refetch?: () => Promise<void>,
    isGone?: () => boolean,
  }) {
    if (!pid || killingPids.has(pid)) return;
    if (!await confirm(confirmMessage)) return;
    killingPids.add(pid);
    try {
      const { ok } = await apiPost(EP_SYSTEM_PROCESS_KILL, { pid }, { errorMessage: "Failed to kill process" });
      if (!ok || !refetch) return;
      const deadline = Date.now() + DEV_SERVER_KILL_POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await refetch();
        if (!isGone || isGone()) break;
        await new Promise((resolve) => setTimeout(resolve, DEV_SERVER_KILL_POLL_INTERVAL_MS));
      }
    } finally {
      killingPids.delete(pid);
    }
  }

  return { killingPids, killProcess };
}
