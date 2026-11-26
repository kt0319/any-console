import { computed, type ComputedRef, type Ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { excludeCurrentBranch } from "../utils/git.ts";
import type { AsyncState } from "../utils/async-state.ts";

/**
 * DispatchRunView の Branch 表示値と Run を止める理由。Create branch/worktree の on/off で select の意味が変わるため、
 * get/set computed で1つの select を共用する。
 */
export function useDispatchRunBranchGuard(options: {
  selectedWorkspace: Ref<string>,
  createMode: Ref<string>,
  newBranchName: Ref<string>,
  branch: Ref<string>,
  baseBranch: Ref<string>,
  hasBranchField: ComputedRef<boolean>,
  branchesState: Ref<AsyncState<string[]>>,
  localBranches: ComputedRef<string[]>,
  remoteOnlyBranches: ComputedRef<string[]>,
}) {
  const { selectedWorkspace, createMode, newBranchName, branch, baseBranch, hasBranchField, branchesState, localBranches, remoteOnlyBranches } = options;
  const workspaceStore = useWorkspaceStore();

  const isCreatingBranchOrWorktree = computed(() => createMode.value !== "");
  const selectedCreateBranch = computed(() => createMode.value === "branch");

  // server/src/dispatch.rs の ensure_branch と対のUI側ブロック。Create branch は対象が dirty（changed_files、untracked込み）だと
  // 400になるため事前に Run を disable する。
  const targetWorkspaceEntry = computed(() =>
    workspaceStore.allWorkspaces.find((w) => w.name === selectedWorkspace.value),
  );
  const currentBranchName = computed(() => targetWorkspaceEntry.value?.branch || "");

  const branchSelectValue = computed({
    get: () => {
      const value = isCreatingBranchOrWorktree.value ? baseBranch.value : branch.value;
      return value === currentBranchName.value ? "" : value;
    },
    set: (val) => {
      if (isCreatingBranchOrWorktree.value) baseBranch.value = val;
      else branch.value = val;
    },
  });

  // 選択肢が localBranches と「(current branch)」のみなので、ズレるのは外部から渡された元リクエストの branch が実在しない時だけ。
  // 気付かず Run すると失敗するため事前に disable する。
  const missingBranchBlockReason = computed(() => {
    if (createMode.value !== "") return "";
    // ready（取得成功）時のみ検証する。error時はfail openにする（Run可否はinfoLoading側で扱う）。
    if (branchesState.value.status !== "ready") return "";
    const target = branch.value.trim();
    if (!target || localBranches.value.includes(target) || remoteOnlyBranches.value.includes(target)) return "";
    return `Branch "${target}" does not exist in this workspace.`;
  });

  const isSwitchingBranch = computed(() => {
    if (!hasBranchField.value || !selectedCreateBranch.value) return false;
    const target = newBranchName.value.trim();
    if (!target) return false;
    return target !== currentBranchName.value;
  });
  const selectableBranches = computed(() => excludeCurrentBranch(localBranches.value, currentBranchName.value));
  const selectableRemoteBranches = computed(() => (createMode.value === "" ? remoteOnlyBranches.value : []));
  const currentBranchLabel = computed(() => {
    const current = currentBranchName.value;
    return current ? `${current} (current)` : "(current branch)";
  });
  const workspaceChangedFiles = computed(() => targetWorkspaceEntry.value?.changed_files || 0);
  const dirtyBlockReason = computed(() => {
    if (!isSwitchingBranch.value || workspaceChangedFiles.value <= 0) return "";
    const n = workspaceChangedFiles.value;
    return `Workspace has uncommitted changes (${n} file${n === 1 ? "" : "s"}). Commit or stash them, or clear the branch to run on the current branch.`;
  });

  return {
    branchSelectValue,
    currentBranchLabel,
    selectableBranches,
    selectableRemoteBranches,
    missingBranchBlockReason,
    dirtyBlockReason,
  };
}
