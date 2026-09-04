import { describe, it, expect } from "vitest";
import { findPRForBranch, findRunForBranch, isNoticeableRun, mapGitHubRun } from "../../ui/utils/github-runs.ts";

describe("mapGitHubRun", () => {
  it("workflowNameをname解決とは別に保持する（findRunForBranchのworkflow識別用）", () => {
    const mapped = mapGitHubRun({
      databaseId: 1,
      displayTitle: "fix: 何か直した",
      workflowName: "Deploy to Pi",
      status: "completed",
      conclusion: "failure",
      headBranch: "main",
      url: "https://example.com",
    });
    expect(mapped.name).toBe("fix: 何か直した");
    expect(mapped.workflowName).toBe("Deploy to Pi");
  });
});

describe("findPRForBranch", () => {
  const prs = [
    { number: 1, headRefName: "main" },
    { number: 2, headRefName: "feature/x" },
  ];

  it("headRefNameが一致するPRを返す", () => {
    expect(findPRForBranch(prs, "feature/x")).toEqual({ number: 2, headRefName: "feature/x" });
  });

  it("一致が無ければnull", () => {
    expect(findPRForBranch(prs, "other")).toBeNull();
  });

  it("一覧未取得・ブランチ未解決はnull", () => {
    expect(findPRForBranch(undefined, "main")).toBeNull();
    expect(findPRForBranch(prs, undefined)).toBeNull();
    expect(findPRForBranch(prs, "")).toBeNull();
  });
});

describe("findRunForBranch", () => {
  const runs = [
    { id: 10, headBranch: "main" },
    { id: 11, headBranch: "feature/x" },
  ];

  it("headBranchが一致するrunを返す", () => {
    expect(findRunForBranch(runs, "main")).toEqual({ id: 10, headBranch: "main" });
  });

  it("一致が無い/一覧未取得/ブランチ未解決はnull", () => {
    expect(findRunForBranch(runs, "other")).toBeNull();
    expect(findRunForBranch(null, "main")).toBeNull();
    expect(findRunForBranch(runs, null)).toBeNull();
  });

  it("同一ブランチに複数workflowのrunがある場合、実行中/失敗のrunを先頭一致より優先する", () => {
    const multi = [
      { id: 1, headBranch: "main", workflowName: "CI", status: "completed", conclusion: "success" },
      { id: 2, headBranch: "main", workflowName: "Deploy", status: "in_progress", conclusion: "" },
      { id: 3, headBranch: "main", workflowName: "Release Please", status: "completed", conclusion: "skipped" },
    ];
    expect(findRunForBranch(multi, "main")).toEqual({
      id: 2,
      headBranch: "main",
      workflowName: "Deploy",
      status: "in_progress",
      conclusion: "",
    });
  });

  it("noticeableなrunが無ければ先頭一致を返す", () => {
    const allDone = [
      { id: 1, headBranch: "main", workflowName: "CI", status: "completed", conclusion: "success" },
      { id: 2, headBranch: "main", workflowName: "Deploy", status: "completed", conclusion: "skipped" },
    ];
    expect(findRunForBranch(allDone, "main")).toEqual({
      id: 1,
      headBranch: "main",
      workflowName: "CI",
      status: "completed",
      conclusion: "success",
    });
  });

  it("同一workflowの古い失敗runは、後続の成功runで上書きされnoticeable扱いされない", () => {
    // gh run list は新しい順に返るため、配列の先頭が最新。
    const supersededFailure = [
      { id: 3, headBranch: "main", workflowName: "Deploy", status: "completed", conclusion: "success" },
      { id: 2, headBranch: "main", workflowName: "Deploy", status: "completed", conclusion: "success" },
      { id: 1, headBranch: "main", workflowName: "Deploy", status: "completed", conclusion: "failure" },
    ];
    expect(findRunForBranch(supersededFailure, "main")).toEqual({
      id: 3,
      headBranch: "main",
      workflowName: "Deploy",
      status: "completed",
      conclusion: "success",
    });
  });

  it("同一workflowの最新runが失敗なら、古い成功runがあってもnoticeable扱いする", () => {
    const stillFailing = [
      { id: 2, headBranch: "main", workflowName: "Deploy", status: "completed", conclusion: "failure" },
      { id: 1, headBranch: "main", workflowName: "Deploy", status: "completed", conclusion: "success" },
    ];
    expect(findRunForBranch(stillFailing, "main")).toEqual({
      id: 2,
      headBranch: "main",
      workflowName: "Deploy",
      status: "completed",
      conclusion: "failure",
    });
  });
});

describe("isNoticeableRun", () => {
  it("実行中のrunは表示対象", () => {
    expect(isNoticeableRun({ status: "in_progress", conclusion: "" })).toBe(true);
    expect(isNoticeableRun({ status: "queued", conclusion: "" })).toBe(true);
  });

  it("失敗で完了したrunは表示対象", () => {
    expect(isNoticeableRun({ status: "completed", conclusion: "failure" })).toBe(true);
  });

  it("failure以外で完了したrunは非表示（success/cancelled/skipped等）", () => {
    expect(isNoticeableRun({ status: "completed", conclusion: "success" })).toBe(false);
    expect(isNoticeableRun({ status: "completed", conclusion: "cancelled" })).toBe(false);
    expect(isNoticeableRun({ status: "completed", conclusion: "skipped" })).toBe(false);
  });

  it("runが無ければfalse", () => {
    expect(isNoticeableRun(null)).toBe(false);
    expect(isNoticeableRun(undefined)).toBe(false);
  });
});
