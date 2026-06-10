import { useLongPress } from "./useLongPress.js";
import { useGitHistoryAction } from "./useGitHistoryAction.js";

export function useCommitActionMenu() {
  const { activeEntry: longPressEntry, startMenu: onLongPressStart, endMenu: onLongPressEnd, closeMenu: closeLongPressMenu, isFired: isLongPressFired, isMenuEl } = useLongPress();
  const { execAction: execCommitAction, execReset: execCommitReset, execCreateBranch: execCommitCreateBranch, execMerge: execCommitMerge, execRebase: execCommitRebase } = useGitHistoryAction();

  function toggleActionMenu(entry) {
    if (longPressEntry.value?.hash === entry.hash) {
      longPressEntry.value = null;
    } else {
      longPressEntry.value = entry;
    }
  }

  function onCommitAction(entry, { action, branch, mode }) {
    if (action === "branch") {
      execCommitCreateBranch(entry, closeLongPressMenu);
    } else if (action === "merge") {
      execCommitMerge(branch, closeLongPressMenu);
    } else if (action === "rebase") {
      execCommitRebase(branch, closeLongPressMenu);
    } else if (action === "reset") {
      execCommitReset(entry, mode, closeLongPressMenu);
    } else {
      execCommitAction(action, entry, closeLongPressMenu);
    }
  }

  return {
    longPressEntry,
    onLongPressStart,
    onLongPressEnd,
    closeLongPressMenu,
    isLongPressFired,
    isMenuEl,
    toggleActionMenu,
    onCommitAction,
  };
}
