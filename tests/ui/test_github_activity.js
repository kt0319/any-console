// @ts-check
import { describe, it, expect } from "vitest";
import { describeActivityEvents, describeRunEvent } from "../../ui/utils/github-activity.ts";

const ev = (number, kind = "comment", over = {}) => ({
  kind, target: "issue", number, title: `t${number}`, author: "alice", createdAt: "c", url: "u", overflow: false, ...over,
});

describe("describeActivityEvents", () => {
  it("1件の項目は番号とタイトル付きの文言にする", () => {
    expect(describeActivityEvents([ev(1)], "issue")).toBe("#1 1 new comment: t1");
    expect(describeActivityEvents([ev(1), ev(1)], "issue")).toBe("#1 2 new comments: t1");
  });

  it("コメントとレビューが両方あれば並べる", () => {
    expect(describeActivityEvents([ev(1), ev(1), ev(1, "review")], "PR")).toBe("#1 2 new comments, 1 new review: t1");
  });

  it("複数項目は1つにまとめ、種別ごとに合算する", () => {
    const events = [ev(1), ev(2), ev(2), ev(3, "review")];
    expect(describeActivityEvents(events, "PR")).toBe("3 PRs: 3 new comments, 1 new review");
  });

  it("overflow の項目は件数に + を付ける", () => {
    const events = Array.from({ length: 10 }, () => ev(1, "comment", { overflow: true }));
    expect(describeActivityEvents(events, "issue")).toBe("#1 10+ new comments: t1");
  });

  it("run と空配列は対象外（null）", () => {
    expect(describeActivityEvents([], "issue")).toBeNull();
    expect(describeActivityEvents([ev(1, "run")], "issue")).toBeNull();
  });
});

describe("describeRunEvent", () => {
  it("[名前] conclusion の形にし、conclusion が無ければ completed", () => {
    expect(describeRunEvent(ev(1, "run", { title: "CI", conclusion: "failure" }))).toBe("[CI] failure");
    expect(describeRunEvent(ev(1, "run", { title: "", workflow: "Build", conclusion: null }))).toBe("[Build] completed");
  });
});
