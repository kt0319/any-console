import { computed } from "vue";
import { abbreviateBranch, truncateHead } from "../utils/git.js";

/**
 * ワークスペースの git ステータスを表示用の派生値に整形する。
 * ステータスバーのテンプレートから表示ロジックを分離してテスト可能にする。
 *
 * @param {import('vue').Ref<any> | import('vue').ComputedRef<any>} ws 対象ワークスペース（未選択時は undefined）
 * @param {import('vue').Ref<boolean> | import('vue').ComputedRef<boolean>} isMobile
 */
export function useWorkspaceGitStatus(ws, isMobile) {
  const isGitRepo = computed(() => ws.value?.is_git_repo === true);
  const hasUpstream = computed(() => ws.value?.has_upstream !== false);
  const hasRemoteBranch = computed(() => ws.value?.has_remote_branch !== false);
  const ahead = computed(() => ws.value?.ahead || 0);
  const behind = computed(() => ws.value?.behind || 0);

  const hasGitActions = computed(() =>
    behind.value > 0 || ahead.value > 0 || !hasUpstream.value,
  );
  const isDirty = computed(() => ws.value && ws.value.clean === false);

  const statusLoading = computed(() => ws.value && ws.value.last_commit_message === undefined);

  const branchParts = computed(() => {
    const branch = ws.value?.branch || "";
    if (!isMobile.value) return { abbr: "", rest: branch };
    const parts = abbreviateBranch(branch);
    parts.rest = truncateHead(parts.rest, 14);
    return parts;
  });
  const isBranchLong = computed(() => {
    if (!isMobile.value) return false;
    return (ws.value?.branch?.length || 0) > 10;
  });
  const msgText = computed(() => {
    if (!ws.value) return "";
    if (statusLoading.value) return "Loading";
    return ws.value.last_commit_message || "";
  });
  const changedFiles = computed(() => ws.value?.changed_files || 0);
  const insertions = computed(() => ws.value?.insertions || 0);
  const deletions = computed(() => ws.value?.deletions || 0);

  return {
    isGitRepo,
    hasUpstream,
    hasRemoteBranch,
    ahead,
    behind,
    hasGitActions,
    isDirty,
    statusLoading,
    branchParts,
    isBranchLong,
    msgText,
    changedFiles,
    insertions,
    deletions,
  };
}
