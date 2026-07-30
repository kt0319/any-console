import { useGitHistoryAction } from "./useGitHistoryAction.js";

export function useCommitActionMenu() {
  const { execAction: execCommitAction, execReset: execCommitReset, execCreateBranch: execCommitCreateBranch, execMerge: execCommitMerge, execRebase: execCommitRebase } = useGitHistoryAction();

  function onCommitAction(entry, { action, branch, mode }, closeFn) {
    if (action === "branch") {
      execCommitCreateBranch(entry, closeFn);
    } else if (action === "merge") {
      execCommitMerge(branch, closeFn);
    } else if (action === "rebase") {
      execCommitRebase(branch, closeFn);
    } else if (action === "reset") {
      execCommitReset(entry, mode, closeFn);
    } else {
      execCommitAction(action, entry, closeFn);
    }
  }

  return { onCommitAction };
}
