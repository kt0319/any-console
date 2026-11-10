// Dispatch 履歴項目（recent）の結果報告の表示判定（純粋関数）。
// 起動の成否（outcome）と結果の報告有無は別々の事実として扱い、
// idle・終了・時間経過から「完成」を導かない。

export type ReportState = "none" | "unsupported" | "unreported" | "reported";
export type Tone = "ok" | "warn" | "error" | "muted";

type Submitted = {
  summary?: string,
  status?: string,
  open_issues?: string[],
  artifacts?: { commits?: string[], branch?: string | null },
};
export type DispatchReportItem = {
  outcome?: string,
  report_enabled?: boolean,
  report?: { submitted?: Submitted, verified?: Record<string, any>, reported_at?: number },
  session_id?: string,
};

/** direct スコープのトークンで承認なしに実行された履歴項目（auth は `direct:<トークン名>`）。 */
export function isDirectRun(item: { auth?: string } | null | undefined): boolean {
  return !!item?.auth?.startsWith("direct:");
}

export function reportState(item: DispatchReportItem): ReportState {
  if (item.outcome !== "executed") return "none";
  if (item.report?.submitted) return "reported";
  return item.report_enabled ? "unreported" : "unsupported";
}

const STATUS_LABELS: Record<string, string> = {
  completed: "Reported completed",
  partial: "Reported partial",
  unable: "Reported unable",
};

/** サーバが確認できた範囲で、申告されたコミット・ブランチのどれかが存在しなかったか。 */
export function artifactsMissing(item: DispatchReportItem): boolean {
  const verified = item.report?.verified;
  return verified?.branch_exists === false || Object.values(verified?.commits || {}).some((v) => v === false);
}

/** 一覧の行に出す報告バッジ。報告の対象でない項目は null。 */
export function reportBadge(item: DispatchReportItem): { label: string, tone: Tone } | null {
  const state = reportState(item);
  if (state === "none" || state === "unsupported") return null;
  if (state === "unreported") return { label: "Result not reported", tone: "muted" };
  if (artifactsMissing(item)) return { label: "Verification failed", tone: "error" };
  const status = item.report?.submitted?.status || "";
  const tone: Tone = status === "completed" ? "ok" : status === "unable" ? "error" : "warn";
  return { label: STATUS_LABELS[status] || "Reported", tone };
}

/** サーバが確認できたコミットの存否。確認できなかった（null）は unknown。 */
export function commitCheck(item: DispatchReportItem, commit: string): "found" | "missing" | "unknown" {
  const v = item.report?.verified?.commits?.[commit];
  if (v === true) return "found";
  if (v === false) return "missing";
  return "unknown";
}

export function branchCheck(item: DispatchReportItem): "found" | "missing" | "unknown" {
  const v = item.report?.verified?.branch_exists;
  if (v === true) return "found";
  if (v === false) return "missing";
  return "unknown";
}
