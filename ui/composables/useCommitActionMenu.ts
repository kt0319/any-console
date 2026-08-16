import { useGitHistoryAction } from "./useGitHistoryAction.ts";

// GitHistory.vue の CommitEntry 相当（useGitHistoryAction.ts の execAction 等が要求する
// hash/fullHash のみ明示。呼び出し側 GitHistory.vue は Record<string, any> として渡す）。
type CommitEntry = { hash: string, fullHash: string };

export function useCommitActionMenu() {
  const { execAction: execCommitAction, execReset: execCommitReset, execCreateBranch: execCommitCreateBranch, execMerge: execCommitMerge, execRebase: execCommitRebase } = useGitHistoryAction();

  function onCommitAction(entry: CommitEntry, { action, branch }: { action: string, branch?: string }, closeFn?: () => void) {
    if (action === "branch") {
      execCommitCreateBranch(entry, closeFn);
    } else if (action === "merge") {
      execCommitMerge(branch!, closeFn);
    } else if (action === "rebase") {
      execCommitRebase(branch!, closeFn);
    } else if (action === "reset") {
      execCommitReset(entry, closeFn);
    } else {
      execCommitAction(action, entry, closeFn);
    }
  }

  return { onCommitAction };
}
