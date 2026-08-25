import { computed, type ComputedRef, type Ref } from "vue";
import { useInfoPillConfigStore } from "../stores/info-pill-config.ts";
import { usePillPeek } from "./usePillPeek.ts";
import { buildTrailingPeekItems } from "../utils/pill-peek.ts";

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
  const trailingPeekItems = computed(() =>
    buildTrailingPeekItems(options.peekFields.value, infoPillConfig as unknown as Record<string, boolean>));
  return {
    trailingPeekItems,
    ...usePillPeek({ trailingPeekItems, ...options }),
  };
}
