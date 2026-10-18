// @ts-check
import { describe, it, expect } from "vitest";
import { snapshotActivity, describeNewActivity } from "../../ui/utils/github-activity.ts";

const item = (number, commentCount = 0, reviewCount = 0) => ({ number, title: `t${number}`, commentCount, reviewCount });

describe("describeNewActivity", () => {
  it("コメント/レビューが増えた項目だけ文言を返す", () => {
    const prev = snapshotActivity([item(1, 1), item(2, 0, 0)]);
    expect(describeNewActivity(prev, [item(1, 2), item(2, 0, 2)])).toEqual([
      "#1 1 new comment: t1",
      "#2 2 new reviews: t2",
    ]);
  });

  it("前回に無い項目・件数不変・減少は対象外", () => {
    const prev = snapshotActivity([item(1, 3), item(2, 1)]);
    expect(describeNewActivity(prev, [item(1, 3), item(2, 0), item(3, 5)])).toEqual([]);
  });

  it("最後の投稿が自分なら、その1件は増分から除く", () => {
    const prev = snapshotActivity([item(1, 1, 0), item(2, 0, 0)]);
    const items = [
      { ...item(1, 2, 0), lastCommentByMe: true },
      { ...item(2, 0, 1), lastReviewByMe: true },
    ];
    expect(describeNewActivity(prev, items)).toEqual([]);
  });

  it("他者の投稿のあとに自分が投稿した場合は他者分だけ残る", () => {
    const prev = snapshotActivity([item(1, 1)]);
    expect(describeNewActivity(prev, [{ ...item(1, 3), lastCommentByMe: true }])).toEqual([
      "#1 1 new comment: t1",
    ]);
  });

  it("コメントが自分起因でもレビューが他者なら、レビューだけ通知する", () => {
    const prev = snapshotActivity([item(1, 0, 0)]);
    const next = { ...item(1, 1, 1), lastCommentByMe: true };
    expect(describeNewActivity(prev, [next])).toEqual(["#1 1 new review: t1"]);
  });

  it("件数が100件を超えても増分を数えられる", () => {
    const prev = snapshotActivity([item(1, 130)]);
    expect(describeNewActivity(prev, [item(1, 131)])).toEqual(["#1 1 new comment: t1"]);
  });
});
