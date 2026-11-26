// GitHub PR / Actions run 一覧から「現在のブランチに対応する項目」を引く純粋関数（PRピル / Actionsピルの表示判定用）。

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

/** `github/runs` の1件を UI 用の共通形へ整形する。表示名は displayTitle || workflowName || name の順で解決する。 */
export function mapGitHubRun(item: Record<string, any>) {
  return {
    id: item.databaseId ?? item.id,
    name: item.displayTitle || item.workflowName || item.name || "",
    // findRunForBranch が同じ workflow 内の最新 run を判定するために保持する（name は displayTitle 優先でコミットメッセージ由来になりうる）。
    workflowName: item.workflowName || "",
    status: item.status || "",
    conclusion: item.conclusion || "",
    headBranch: item.headBranch || "",
    event: item.event || "",
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
 * 同一ブランチには複数の workflow run が載りうる。noticeable な run（実行中・失敗）があれば優先し、無ければ先頭の一致を返す。
 * 同じ workflow 内では最新の run だけを判定対象にする（runs は新しい順の前提。既に直った失敗をピルが拾い続けないため）。
 */
export function findRunForBranch(
  runs: { headBranch?: string; event?: string; workflowName?: string; status?: string; conclusion?: string }[] | null | undefined,
  branch: string | null | undefined,
): { headBranch?: string; status?: string; conclusion?: string } | null {
  if (!Array.isArray(runs) || !branch) return null;
  // workflow_run で起動した run（Dispatch on CI failure 等）の headBranch は対象ブランチでなく
  // 既定ブランチになるため、ブランチの run としては扱わない。
  const matches = runs.filter((run) => run.headBranch === branch && run.event !== "workflow_run");
  if (matches.length === 0) return null;
  const seenWorkflows = new Set<string>();
  const latestPerWorkflow = matches.filter((run) => {
    const key = run.workflowName || "";
    if (seenWorkflows.has(key)) return false;
    seenWorkflows.add(key);
    return true;
  });
  return latestPerWorkflow.find(isNoticeableRun) || matches[0];
}

/** failure 以外の完了 run（cancelled/skipped/timed_out 等を含む）は実害の無い終了としてピルに出さない。 */
export function isNoticeableRun(run: { status?: string; conclusion?: string } | null | undefined): boolean {
  if (!run) return false;
  return !(run.status === "completed" && run.conclusion !== "failure");
}
