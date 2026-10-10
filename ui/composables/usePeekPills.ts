import { computed, type ComputedRef, type Ref } from "vue";
import { useInfoPillConfigStore } from "../stores/info-pill-config.ts";
import { usePillPeek } from "./usePillPeek.ts";
import { buildTrailingPeekItems } from "../utils/pill-peek.ts";
import { useApi } from "./useApi.ts";
import { parseGitGraphOutput } from "../utils/git-graph.ts";

/**
 * peekFields から trailingPeekItems の組み立て（info-pill 設定の反映）と
 * usePillPeek の呼び出しまでを束ねる。TerminalPane / SessionSidebarRow の
 * 配線が同形のため一本化する（フィールド追加時に片方だけ直すズレを防ぐ）。
 */
export function usePeekPills(options: {
  peekFields: ComputedRef<Record<string, any>>,
  paneWorkspace: ComputedRef<Record<string, any> | undefined>,
  workspaceKey: () => string | null | undefined,
  prsByWorkspace: Ref<Record<string, any[]>>,
  runsByWorkspace: Ref<Record<string, any[]>>,
  devServerEntry: ComputedRef<Record<string, any> | null>,
  ahead: Ref<number>,
  behind: Ref<number>,
}) {
  const infoPillConfig = useInfoPillConfigStore();
  const { apiGet, wsEndpoint } = useApi();
  // push/pull完了の検出時、HEADの先頭N件が今回push/pullされたコミットと一致する
  // （pushはahead分、fast-forwardのpullは取り込んだ分）。失敗時は件名無しで足りる。
  async function fetchRecentSubjects(workspace: string, count: number): Promise<string[]> {
    const { ok, data } = await apiGet(wsEndpoint(workspace, `git-log?limit=${count}&skip=0&graph=true`));
    if (!ok) return [];
    return parseGitGraphOutput(data?.stdout)
      .filter((row) => row.entry)
      .slice(0, count)
      .map((row) => String(row.entry!.message).split("\n")[0]);
  }
  const trailingPeekItems = computed(() =>
    buildTrailingPeekItems(options.peekFields.value, infoPillConfig as unknown as Record<string, boolean>));
  return {
    trailingPeekItems,
    ...usePillPeek({ trailingPeekItems, fetchRecentSubjects, ...options }),
  };
}
