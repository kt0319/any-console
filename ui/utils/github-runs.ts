// GitHub PR / Actions run 一覧から「現在のブランチに対応する項目」を引くための
// 純粋関数。TerminalPane の PRピル / Actionsピルの表示判定に使う。

/** `github/pulls` の1件を UI 用の共通形へ整形する（PRピル・PRペインの両方が使う）。 */
export function mapGitHubPR(item: Record<string, any>) {
  return {
    number: item.number,
    title: item.title,
    author: item.author?.login || "",
    isDraft: !!item.isDraft,
    headRefName: item.headRefName || "",
    labels: item.labels || [],
  };
}

/**
 * `github/runs` の1件を UI 用の共通形へ整形する。run の表示名は
 * displayTitle || workflowName || name の順で解決する — Actionsピルと
 * Actionsペインで同じ run が別ラベルにならないよう、必ずここを通す。
 */
export function mapGitHubRun(item: Record<string, any>) {
  return {
    id: item.databaseId ?? item.id,
    name: item.displayTitle || item.workflowName || item.name || "",
    status: item.status || "",
    conclusion: item.conclusion || "",
    headBranch: item.headBranch || "",
    url: item.url || "",
  };
}

export function findPRForBranch(
  prs: { headRefName?: string }[] | null | undefined,
  branch: string | null | undefined,
): { headRefName?: string } | null {
  if (!Array.isArray(prs) || !branch) return null;
  return prs.find((pr) => pr.headRefName === branch) || null;
}

/**
 * 同一ブランチには CI / Release Please / Dispatch on CI failure 等、複数の
 * workflow run が同時に載りうる。単純な先頭一致だと、たまたま先に完了した
 * run の陰で他の run が実行中でもピルに気づけない。noticeable な run（実行
 * 中・失敗）があればそれを優先し、無ければ先頭の一致を返す。
 */
export function findRunForBranch(
  runs: { headBranch?: string; status?: string; conclusion?: string }[] | null | undefined,
  branch: string | null | undefined,
): { headBranch?: string; status?: string; conclusion?: string } | null {
  if (!Array.isArray(runs) || !branch) return null;
  const matches = runs.filter((run) => run.headBranch === branch);
  if (matches.length === 0) return null;
  return matches.find(isNoticeableRun) || matches[0];
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
