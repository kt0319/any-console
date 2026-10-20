// @ts-check
import { describe, it, expect } from "vitest";
import { snapshotActivity, describeNewActivity, describeActivityEvents, describeRunEvent } from "../../ui/utils/github-activity.ts";

const item = (number, commentCount = 0, reviewCount = 0) => ({ number, title: `t${number}`, commentCount, reviewCount });

describe("describeNewActivity", () => {
  it("1件だけ増えた場合は番号とタイトル付きの文言を返す", () => {
    const prev = snapshotActivity([item(1, 1), item(2, 0, 0)]);
    expect(describeNewActivity(prev, [item(1, 2), item(2, 0, 0)], "issue")).toBe("#1 1 new comment: t1");
    expect(describeNewActivity(prev, [item(1, 1), item(2, 0, 2)], "issue")).toBe("#2 2 new reviews: t2");
  });

  it("コメントとレビューが同時に増えたら両方並べる", () => {
    const prev = snapshotActivity([item(1, 1)]);
    expect(describeNewActivity(prev, [item(1, 3, 1)], "PR")).toBe("#1 2 new comments, 1 new review: t1");
  });

  it("前回に無い項目・件数不変・減少は対象外（null）", () => {
    const prev = snapshotActivity([item(1, 3), item(2, 1)]);
    expect(describeNewActivity(prev, [item(1, 3), item(2, 0), item(3, 5)], "issue")).toBeNull();
  });

  it("複数項目で増えたら1つの文言へまとめる", () => {
    const prev = snapshotActivity([item(1, 0), item(2, 1), item(3, 0)]);
    const items = [item(1, 2), item(2, 4), item(3, 0)];
    expect(describeNewActivity(prev, items, "issue")).toBe("2 issues: 5 new comments");
  });

  it("まとめ表示ではコメントとレビューをそれぞれ合算する", () => {
    const prev = snapshotActivity([item(1, 0, 0), item(2, 0, 0)]);
    expect(describeNewActivity(prev, [item(1, 1, 1), item(2, 0, 2)], "PR")).toBe("2 PRs: 1 new comment, 3 new reviews");
  });

  it("最後の投稿が自分なら、その1件は増分から除く", () => {
    const prev = snapshotActivity([item(1, 1, 0), item(2, 0, 0)]);
    const items = [
      { ...item(1, 2, 0), lastCommentByMe: true },
      { ...item(2, 0, 1), lastReviewByMe: true },
    ];
    expect(describeNewActivity(prev, items, "issue")).toBeNull();
  });

  it("自分起因の項目はまとめ表示の件数にも含めない", () => {
    const prev = snapshotActivity([item(1, 0), item(2, 0), item(3, 0)]);
    const items = [{ ...item(1, 1), lastCommentByMe: true }, item(2, 1), item(3, 1)];
    expect(describeNewActivity(prev, items, "issue")).toBe("2 issues: 2 new comments");
  });

  it("他者の投稿のあとに自分が投稿した場合は他者分だけ残る", () => {
    const prev = snapshotActivity([item(1, 1)]);
    expect(describeNewActivity(prev, [{ ...item(1, 3), lastCommentByMe: true }], "issue")).toBe("#1 1 new comment: t1");
  });

  it("コメントが自分起因でもレビューが他者なら、レビューだけ通知する", () => {
    const prev = snapshotActivity([item(1, 0, 0)]);
    const next = { ...item(1, 1, 1), lastCommentByMe: true };
    expect(describeNewActivity(prev, [next], "PR")).toBe("#1 1 new review: t1");
  });

  it("件数が100件を超えても増分を数えられる", () => {
    const prev = snapshotActivity([item(1, 130)]);
    expect(describeNewActivity(prev, [item(1, 131)], "issue")).toBe("#1 1 new comment: t1");
  });
});

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
