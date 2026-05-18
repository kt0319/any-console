// @ts-check
import { describe, it, expect } from "vitest";
import { isEmptyPaneId, makeEmptyPaneId, realTabIds, countRealPanes } from "../../ui/utils/empty-pane.js";

describe("isEmptyPaneId", () => {
  it("'empty:'プレフィックスの文字列を真と判定", () => {
    expect(isEmptyPaneId("empty:1")).toBe(true);
    expect(isEmptyPaneId("empty:42")).toBe(true);
  });

  it("数値タブIDは偽", () => {
    expect(isEmptyPaneId(1)).toBe(false);
    expect(isEmptyPaneId(0)).toBe(false);
  });

  it("null/undefined/関係ない文字列は偽", () => {
    expect(isEmptyPaneId(null)).toBe(false);
    expect(isEmptyPaneId(undefined)).toBe(false);
    expect(isEmptyPaneId("foo")).toBe(false);
    expect(isEmptyPaneId("")).toBe(false);
  });
});

describe("makeEmptyPaneId", () => {
  it("連番付きIDを返す", () => {
    expect(makeEmptyPaneId(1)).toBe("empty:1");
    expect(makeEmptyPaneId(99)).toBe("empty:99");
  });

  it("生成したIDはisEmptyPaneIdで真", () => {
    expect(isEmptyPaneId(makeEmptyPaneId(7))).toBe(true);
  });
});

describe("realTabIds", () => {
  it("空きペインを除いた数値IDだけを返す", () => {
    expect(realTabIds([1, "empty:1", 2, "empty:2"])).toEqual([1, 2]);
  });

  it("空配列はそのまま空配列", () => {
    expect(realTabIds([])).toEqual([]);
    expect(realTabIds(null)).toEqual([]);
  });

  it("nullや未定義の要素も除外", () => {
    expect(realTabIds([1, null, 2, undefined, "empty:3"])).toEqual([1, 2]);
  });
});

describe("countRealPanes", () => {
  it("有効なタブの数だけ数える", () => {
    expect(countRealPanes([1, 2, 3])).toBe(3);
    expect(countRealPanes([1, "empty:1", 2])).toBe(2);
    expect(countRealPanes(["empty:1", "empty:2"])).toBe(0);
  });
});
