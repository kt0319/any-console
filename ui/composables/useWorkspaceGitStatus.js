import { computed } from "vue";

/**
 * ワークスペースの git ステータスを表示用の派生値に整形する。
 * TerminalPane の Info Pills（変更行数・ahead/behind バッジ等）から使う。
 * 廃止済み WorkspaceStatusBar 向けの派生値（branchParts/msgText 等）は削除済み。
 *
 * @param {import('vue').Ref<any> | import('vue').ComputedRef<any>} ws 対象ワークスペース（未選択時は undefined）
 */
export function useWorkspaceGitStatus(ws) {
  const isGitRepo = computed(() => ws.value?.is_git_repo === true);
  const hasUpstream = computed(() => ws.value?.has_upstream !== false);
  const ahead = computed(() => ws.value?.ahead || 0);
  const behind = computed(() => ws.value?.behind || 0);

  const isDirty = computed(() => ws.value && ws.value.clean === false);

  const changedFiles = computed(() => ws.value?.changed_files || 0);
  const insertions = computed(() => ws.value?.insertions || 0);
  const deletions = computed(() => ws.value?.deletions || 0);

  return {
    isGitRepo,
    hasUpstream,
    ahead,
    behind,
    isDirty,
    changedFiles,
    insertions,
    deletions,
  };
}
