// @ts-check
import { describe, it, expect } from "vitest";
import {
  artifactsMissing,
  branchCheck,
  commitCheck,
  reportBadge,
  reportState,
} from "../../ui/utils/dispatch-report.ts";

const submitted = (over = {}) => ({
  summary: "done",
  status: "completed",
  ...over,
});
const reported = (over = {}, extra = {}) => ({
  outcome: "executed",
  report_enabled: true,
  report: { submitted: submitted(over), verified: {} },
  ...extra,
});

describe("reportState", () => {
  it("報告が無い実行は、終了していても未報告として扱う", () => {
    expect(reportState({ outcome: "executed", report_enabled: true })).toBe("unreported");
    expect(reportBadge({ outcome: "executed", report_enabled: true })).toEqual({ label: "Result not reported", tone: "muted" });
  });

  it("報告に対応しない実行と起動失敗は報告の対象外", () => {
    expect(reportState({ outcome: "executed" })).toBe("unsupported");
    expect(reportState({ outcome: "failed", report_enabled: true })).toBe("none");
    expect(reportBadge({ outcome: "executed" })).toBeNull();
  });

  it("報告があれば reported", () => {
    expect(reportState(reported())).toBe("reported");
  });
});

describe("reportBadge", () => {
  it("申告の状態をそのままバッジにする", () => {
    expect(reportBadge(reported())).toEqual({ label: "Reported completed", tone: "ok" });
    expect(reportBadge(reported({ status: "partial" }))).toEqual({ label: "Reported partial", tone: "warn" });
    expect(reportBadge(reported({ status: "unable" }))).toEqual({ label: "Reported unable", tone: "error" });
  });

  it("サーバが存在を確認できなかった成果物があれば、完了の申告でも成功として表示しない", () => {
    const item = reported();
    item.report.verified = { commits: { dead: false }, branch_exists: true };
    expect(artifactsMissing(item)).toBe(true);
    expect(reportBadge(item)).toEqual({ label: "Verification failed", tone: "error" });
  });
});

describe("サーバ確認の成果物", () => {
  const item = reported({}, {});
  item.report.verified = { commits: { abc1234: true, dead: false, unk: null }, branch_exists: false };
  it("存在・不在・確認不能を区別する", () => {
    expect(commitCheck(item, "abc1234")).toBe("found");
    expect(commitCheck(item, "dead")).toBe("missing");
    expect(commitCheck(item, "unk")).toBe("unknown");
    expect(commitCheck(item, "other")).toBe("unknown");
    expect(branchCheck(item)).toBe("missing");
    expect(branchCheck(reported())).toBe("unknown");
  });

  it("確認できなかった（null）だけでは missing にしない", () => {
    const unchecked = reported();
    unchecked.report.verified = { commits: { unk: null }, branch_exists: null };
    expect(artifactsMissing(unchecked)).toBe(false);
  });
});
