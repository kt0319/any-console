// Dispatch 履歴項目（recent）の結果報告の表示判定（純粋関数）。
// 起動の成否（outcome）・結果の報告有無・検証結果・利用者の確認は別々の事実として扱い、
// idle・終了・時間経過から「完成」「検証済み」を導かない。

import { PREVIEW_PROXY_PORT_OFFSET } from "./constants.ts";

export type ReportState = "none" | "unsupported" | "unreported" | "reported";
export type Tone = "ok" | "warn" | "error" | "muted";
export type VerificationTone = "none" | "passed" | "incomplete" | "failed";

type Verification = { name: string, result: string, detail?: string };
type Submitted = {
  summary?: string,
  status?: string,
  verifications?: Verification[],
  artifacts?: { commits?: string[], branch?: string | null, preview_port?: number | null },
};
export type DispatchReportItem = {
  outcome?: string,
  report_enabled?: boolean,
  report?: { submitted?: Submitted, verified?: Record<string, any>, reported_at?: number },
  session_id?: string,
};

export function reportState(item: DispatchReportItem): ReportState {
  if (item.outcome !== "executed") return "none";
  if (item.report?.submitted) return "reported";
  return item.report_enabled ? "unreported" : "unsupported";
}

const RESULT_KEYS = ["passed", "failed", "skipped", "unknown"] as const;

export function verificationCounts(item: DispatchReportItem): Record<(typeof RESULT_KEYS)[number], number> {
  const counts = { passed: 0, failed: 0, skipped: 0, unknown: 0 };
  for (const v of item.report?.submitted?.verifications || []) {
    if (v.result in counts) counts[v.result as keyof typeof counts]++;
  }
  return counts;
}

/** 検証の総括。1件でも失敗があれば failed、全件 passed のときだけ passed。 */
export function verificationTone(item: DispatchReportItem): VerificationTone {
  const list = item.report?.submitted?.verifications || [];
  if (!list.length) return "none";
  const c = verificationCounts(item);
  if (c.failed) return "failed";
  return c.passed === list.length ? "passed" : "incomplete";
}

const STATUS_LABELS: Record<string, string> = {
  completed: "Reported completed",
  partial: "Reported partial",
  unable: "Reported unable",
};

/** 一覧の行に出す報告バッジ。報告の対象でない項目は null。 */
export function reportBadge(item: DispatchReportItem): { label: string, tone: Tone } | null {
  const state = reportState(item);
  if (state === "none" || state === "unsupported") return null;
  if (state === "unreported") return { label: "Result not reported", tone: "muted" };
  if (verificationTone(item) === "failed") return { label: "Verification failed", tone: "error" };
  const status = item.report?.submitted?.status || "";
  const tone: Tone = status === "completed" && verificationTone(item) === "passed" ? "ok" : status === "unable" ? "error" : "warn";
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

export function previewProxyPort(port: number | null | undefined): number | null {
  return port ? port + PREVIEW_PROXY_PORT_OFFSET : null;
}
