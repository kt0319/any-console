// @ts-check
import { describe, it, expect } from "vitest";
import { nextTabIndex } from "../../ui/utils/tab-nav.js";

describe("nextTabIndex", () => {
  it("ArrowRightは次のindex、末尾では先頭へ折り返す", () => {
    expect(nextTabIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextTabIndex("ArrowRight", 2, 3)).toBe(0);
  });

  it("ArrowLeftは前のindex、先頭では末尾へ折り返す", () => {
    expect(nextTabIndex("ArrowLeft", 2, 3)).toBe(1);
    expect(nextTabIndex("ArrowLeft", 0, 3)).toBe(2);
  });

  it("Home/Endは先頭/末尾へ移動する", () => {
    expect(nextTabIndex("Home", 2, 3)).toBe(0);
    expect(nextTabIndex("End", 0, 3)).toBe(2);
  });

  it("対象外のキーはnull", () => {
    expect(nextTabIndex("ArrowDown", 1, 3)).toBeNull();
    expect(nextTabIndex("Enter", 1, 3)).toBeNull();
  });

  it("タブ0件・現在indexが不明(-1)ならnull", () => {
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
    expect(nextTabIndex("ArrowRight", -1, 3)).toBeNull();
  });

  it("1件のみでも矢印キーは同じindexに留まる", () => {
    expect(nextTabIndex("ArrowRight", 0, 1)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 1)).toBe(0);
  });
});
