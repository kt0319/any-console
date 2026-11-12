import { computed, type ComputedRef, type Ref } from "vue";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { excludeCurrentBranch } from "../utils/git.ts";
import type { AsyncState } from "../utils/async-state.ts";

/**
 * Dispatch 実行画面（DispatchRunView.vue）の Branch まわりの表示用の値と、Run を止める理由。
 * Branch select は Create branch/worktree の on/off で意味が変わる（対象ブランチ or 分岐元ブランチ）ため、
 * 書き込み先を切り替える get/set computed で1つの select 要素を共用する。
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

  // サーバ側のガード（server/src/dispatch.rs の ensure_branch）と対になるUI側の事前
  // ブロック。新規ブランチを作成するdispatch（Create branchオン）は対象ワークスペースが
  // dirtyだと400で失敗するため、送信前に理由を示してRunをdisableする（既存ブランチへの
  // checkoutは対象外）。dirty判定は changed_files（untracked込み）に揃える。
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

  // Change branch のselectはlocalBranchesと「(current branch)」しか選択肢が無いため
  // ユーザー操作では不正値にならない。ズレるのは外部（CI等）から渡された元リクエストの
  // branchが実在しない初期値の時だけ。気付かずRunすると失敗するので事前に検知しdisableする。
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
