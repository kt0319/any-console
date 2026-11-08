// @ts-check
import { describe, it, expect } from "vitest";
import {
  branchCheck,
  commitCheck,
  previewProxyPort,
  reportBadge,
  reportState,
  verificationTone,
} from "../../ui/utils/dispatch-report.ts";

const submitted = (over = {}) => ({
  summary: "done",
  status: "completed",
  verifications: [{ name: "test", result: "passed" }],
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

  it("報告に対応しないジョブと起動失敗は報告の対象外", () => {
    expect(reportState({ outcome: "executed" })).toBe("unsupported");
    expect(reportState({ outcome: "failed", report_enabled: true })).toBe("none");
    expect(reportBadge({ outcome: "executed" })).toBeNull();
  });

  it("報告があれば reported", () => {
    expect(reportState(reported())).toBe("reported");
  });
});

describe("verificationTone / reportBadge", () => {
  it("検証が失敗していれば完了の申告でも成功として表示しない", () => {
    const item = reported({ verifications: [{ name: "t", result: "failed" }, { name: "l", result: "passed" }] });
    expect(verificationTone(item)).toBe("failed");
    expect(reportBadge(item)).toEqual({ label: "Verification failed", tone: "error" });
  });

  it("未実施・確認不能が混じる、または検証の報告が無い場合は passed にしない", () => {
    expect(verificationTone(reported({ verifications: [{ name: "a", result: "passed" }, { name: "b", result: "skipped" }] }))).toBe("incomplete");
    expect(verificationTone(reported({ verifications: [{ name: "a", result: "unknown" }] }))).toBe("incomplete");
    expect(verificationTone(reported({ verifications: [] }))).toBe("none");
    expect(reportBadge(reported({ verifications: [] })).tone).toBe("warn");
  });

  it("全件 passed かつ completed のときだけ ok", () => {
    expect(reportBadge(reported())).toEqual({ label: "Reported completed", tone: "ok" });
    expect(reportBadge(reported({ status: "partial" })).tone).toBe("warn");
    expect(reportBadge(reported({ status: "unable" })).tone).toBe("error");
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

  it("プレビューは proxy ポートへ変換する", () => {
    expect(previewProxyPort(3000)).toBe(23000);
    expect(previewProxyPort(null)).toBeNull();
  });
});
