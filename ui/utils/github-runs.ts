// GitHub PR / Actions run 一覧から「現在のブランチに対応する項目」を引くための
// 純粋関数。TerminalPane の PRピル / Actionsピルの表示判定に使う。

export function findPRForBranch(
  prs: { headRefName?: string }[] | null | undefined,
  branch: string | null | undefined,
): { headRefName?: string } | null {
  if (!Array.isArray(prs) || !branch) return null;
  return prs.find((pr) => pr.headRefName === branch) || null;
}

export function findRunForBranch(
  runs: { headBranch?: string }[] | null | undefined,
  branch: string | null | undefined,
): { headBranch?: string } | null {
  if (!Array.isArray(runs) || !branch) return null;
  return runs.find((run) => run.headBranch === branch) || null;
}

/**
 * failure以外で完了したrunはピルに出さない（失敗中・実行中のrunだけ知らせる。
 * success以外にもcancelled/skipped/timed_out等のconclusionがあり、それらは
 * 実害のない終了として扱う）。
 */
export function isNoticeableRun(run: { status?: string; conclusion?: string } | null | undefined): boolean {
  if (!run) return false;
  return !(run.status === "completed" && run.conclusion !== "failure");
}
