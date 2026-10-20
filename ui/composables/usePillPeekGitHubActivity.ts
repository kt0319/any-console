import type { ComputedRef } from "vue";
import { useBusListener } from "./useBusListener.ts";
import { describeActivityEvents, describeRunEvent, type ActivityEvent } from "../utils/github-activity.ts";

type TriggerPeek = (key: string, pushCount: number, pullCount: number, remote: null, guaranteed: boolean, text: string) => void;

// サーバ（github_watch）が確定した新着コメント・レビュー・CI完了を peek に出す。
// PRピルは現在ブランチのPRだけを指すため、通知もそのPRとブランチのrunに揃える。
export function usePillPeekGitHubActivity({ workspaceKey, trailingPeekItems, peekFields, triggerPeek }: {
  workspaceKey: () => string | null | undefined,
  trailingPeekItems: ComputedRef<{ key: string, text: string }[]>,
  peekFields: ComputedRef<Record<string, any>>,
  triggerPeek: TriggerPeek,
}) {
  // 完了通知を出したCI run。イベント経由と一覧ポーリング（シグネチャ変化）経由のどちらが
  // 先に検知しても、同じrunを二重にpeekしないための記録。
  const peekedCompletedRunIds = new Set<string | number>();

  /** 未通知なら通知済みとして記録して true（既に通知済みなら false）。 */
  function claimCompletedRun(runId: string | number): boolean {
    if (peekedCompletedRunIds.has(runId)) return false;
    peekedCompletedRunIds.add(runId);
    return true;
  }

  useBusListener("github:activity", ({ workspace, items }: { workspace?: string, items?: ActivityEvent[] }) => {
    if (!items?.length || workspace !== workspaceKey()) return;
    const hasPill = (key: string) => trailingPeekItems.value.some((item) => item.key === key);
    if (hasPill("prs")) {
      const prNumber = peekFields.value?.branchPR?.number;
      const text = describeActivityEvents(items.filter((ev) => ev.target === "pr" && ev.number === prNumber), "PR");
      if (text) triggerPeek("prs", 0, 0, null, true, text);
    }
    if (hasPill("issues")) {
      const text = describeActivityEvents(items.filter((ev) => ev.target === "issue"), "issue");
      if (text) triggerPeek("issues", 0, 0, null, true, text);
    }
    if (hasPill("actions")) {
      const runs = items.filter((ev) => ev.kind === "run" && ev.branch === peekFields.value?.branch);
      const latest = runs[runs.length - 1];
      if (latest && claimCompletedRun(latest.number)) {
        triggerPeek("actions", 0, 0, null, true, describeRunEvent(latest));
      }
    }
  });

  return { claimCompletedRun };
}
