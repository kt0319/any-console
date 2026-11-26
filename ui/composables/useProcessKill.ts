import { reactive } from "vue";
import { useApi } from "./useApi.ts";
import { useConfirm } from "./useConfirm.ts";
import { EP_SYSTEM_PROCESS_KILL } from "../utils/endpoints.ts";
import { DEV_SERVER_KILL_POLL_INTERVAL_MS, DEV_SERVER_KILL_POLL_TIMEOUT_MS } from "../utils/constants.ts";

// プロセスkill（SIGTERM）ボタンの共通ロジック。killingPids は他画面のボタンまで disabled にしないよう、呼び出し側が毎回 useProcessKill() を呼んで独立させる。
export function useProcessKill() {
  const { apiPost } = useApi();
  const { confirm } = useConfirm();
  const killingPids = reactive(new Set<number>());

  /**
   * @param refetch kill後に一覧を再取得する関数。省略時は再取得せず即座に killingPids から外す。
   * @param isGone refetch後、対象が一覧から消えたか。true かタイムアウトまで refetch を繰り返す。
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
