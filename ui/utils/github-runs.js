// GitHub PR / Actions run 一覧から「現在のブランチに対応する項目」を引くための
// 純粋関数。TerminalPane の PRピル / Actionsピルの表示判定に使う。

/**
 * @param {{headRefName?: string}[] | null | undefined} prs
 * @param {string | null | undefined} branch
 * @returns {{headRefName?: string} | null}
 */
export function findPRForBranch(prs, branch) {
  if (!Array.isArray(prs) || !branch) return null;
  return prs.find((pr) => pr.headRefName === branch) || null;
}

/**
 * @param {{headBranch?: string}[] | null | undefined} runs
 * @param {string | null | undefined} branch
 * @returns {{headBranch?: string} | null}
 */
export function findRunForBranch(runs, branch) {
  if (!Array.isArray(runs) || !branch) return null;
  return runs.find((run) => run.headBranch === branch) || null;
}

/**
 * failure以外で完了したrunはピルに出さない（失敗中・実行中のrunだけ知らせる。
 * success以外にもcancelled/skipped/timed_out等のconclusionがあり、それらは
 * 実害のない終了として扱う）。
 * @param {{status?: string, conclusion?: string} | null | undefined} run
 * @returns {boolean}
 */
export function isNoticeableRun(run) {
  if (!run) return false;
  return !(run.status === "completed" && run.conclusion !== "failure");
}
