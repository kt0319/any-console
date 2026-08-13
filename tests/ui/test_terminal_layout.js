// @ts-check
import { describe, it, expect } from "vitest";
import { calcGridLayout, buildGridRows } from "../../ui/utils/terminal-layout.ts";

describe("calcGridLayout", () => {
  it("returns [1] for count 1", () => {
    expect(calcGridLayout(1)).toEqual([1]);
  });

  it("returns [1,1] for count 2", () => {
    expect(calcGridLayout(2)).toEqual([1, 1]);
  });

  it("returns [2,1] for count 3", () => {
    expect(calcGridLayout(3)).toEqual([2, 1]);
  });

  it("returns [2,2] for count 4", () => {
    expect(calcGridLayout(4)).toEqual([2, 2]);
  });

  it("returns [3,2] for count 5", () => {
    expect(calcGridLayout(5)).toEqual([3, 2]);
  });

  it("returns [3,3] for count 6", () => {
    expect(calcGridLayout(6)).toEqual([3, 3]);
  });

  it("handles count 0 (edge case)", () => {
    expect(calcGridLayout(0)).toEqual([1]);
  });
});

describe("buildGridRows", () => {
  it("builds single row for 1 id", () => {
    expect(buildGridRows([10])).toEqual([[{ tabId: 10, globalIndex: 0 }]]);
  });

  it("builds two rows for 2 ids", () => {
    expect(buildGridRows([1, 2])).toEqual([
      [{ tabId: 1, globalIndex: 0 }],
      [{ tabId: 2, globalIndex: 1 }],
    ]);
  });

  it("builds layout for 3 ids", () => {
    expect(buildGridRows([1, 2, 3])).toEqual([
      [{ tabId: 1, globalIndex: 0 }, { tabId: 2, globalIndex: 1 }],
      [{ tabId: 3, globalIndex: 2 }],
    ]);
  });

  it("builds layout for 4 ids", () => {
    expect(buildGridRows([1, 2, 3, 4])).toEqual([
      [{ tabId: 1, globalIndex: 0 }, { tabId: 2, globalIndex: 1 }],
      [{ tabId: 3, globalIndex: 2 }, { tabId: 4, globalIndex: 3 }],
    ]);
  });
});
