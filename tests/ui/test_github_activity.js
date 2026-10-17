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
});
