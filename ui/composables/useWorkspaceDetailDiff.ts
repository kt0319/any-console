import { ref, computed } from "vue";

/**
 * WorkspaceDetail の Files タブ・diff 表示に関する状態（選択中の diff ファイル・
 * ファイルブラウザの深さ）をまとめる composable。WorkspaceDetail から切り出したもの。
 */
export function useWorkspaceDetailDiff() {
  const fileBrowserDeep = ref(false);
  const selectedDiffFile = ref("");
  const diffMessage = ref("");
  const selectedDiffIsWorkingTree = ref(false);
  const selectedDiffCommitHash = ref("");

  const filesBrowsing = computed(() => fileBrowserDeep.value || !!selectedDiffFile.value);

  function onFileBrowserState({ atRoot, fileOpen }: { atRoot: boolean, fileOpen: boolean }) {
    fileBrowserDeep.value = !atRoot || fileOpen;
  }

  function clearDiffSelection() {
    selectedDiffFile.value = "";
    diffMessage.value = "";
    selectedDiffIsWorkingTree.value = false;
    selectedDiffCommitHash.value = "";
  }

  function selectDiffFile({ path, isWorkingTree, commitHash }: { path: string, isWorkingTree?: boolean, commitHash?: string }) {
    selectedDiffFile.value = path;
    diffMessage.value = "";
    selectedDiffIsWorkingTree.value = !!isWorkingTree;
    selectedDiffCommitHash.value = commitHash || "";
  }

  return {
    fileBrowserDeep,
    selectedDiffFile,
    diffMessage,
    selectedDiffIsWorkingTree,
    selectedDiffCommitHash,
    filesBrowsing,
    onFileBrowserState,
    clearDiffSelection,
    selectDiffFile,
  };
}
