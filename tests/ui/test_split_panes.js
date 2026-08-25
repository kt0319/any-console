import { describe, it, expect } from "vitest";
import { cornerToGridIndex, soleRemainingTab, buildPanesWithTabAt, resolveExitRestoreTab } from "../../ui/utils/split-panes.ts";

describe("cornerToGridIndex", () => {
  it("4ペイン(2x2)の四隅を正しく解決する", () => {
    expect(cornerToGridIndex(4, "top-left")).toBe(0);
    expect(cornerToGridIndex(4, "top-right")).toBe(1);
    expect(cornerToGridIndex(4, "bottom-left")).toBe(2);
    expect(cornerToGridIndex(4, "bottom-right")).toBe(3);
  });
});

describe("soleRemainingTab", () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }];
  it("除外後の候補が1つならそれを返す", () => {
    expect(soleRemainingTab(tabs, [1, 2])).toEqual({ id: 3 });
  });
  it("候補が複数・0件なら null", () => {
    expect(soleRemainingTab(tabs, [1])).toBeNull();
    expect(soleRemainingTab(tabs, [1, 2, 3])).toBeNull();
    expect(soleRemainingTab(null, [])).toBeNull();
  });
});

describe("buildPanesWithTabAt", () => {
  it("空きペインで埋めて target にタブを置く（範囲はクランプ）", () => {
    let seq = 0;
    const next = () => `__empty_${++seq}__`;
    const ids = buildPanesWithTabAt(7, 4, 2, next);
    expect(ids).toHaveLength(4);
    expect(ids[2]).toBe(7);
    expect(ids.filter((id) => id === 7)).toHaveLength(1);
    expect(buildPanesWithTabAt(7, 3, 99, next)[2]).toBe(7);
  });
});

describe("resolveExitRestoreTab", () => {
  it("targetTabId が最優先", () => {
    expect(resolveExitRestoreTab([1, 2], 0, 2)).toBe(2);
  });
  it("アクティブペインの実タブ → 最初の実タブの順にフォールバック", () => {
    expect(resolveExitRestoreTab([1, 2], 1)).toBe(2);
    expect(resolveExitRestoreTab(["empty:1", 5], 0)).toBe(5);
    expect(resolveExitRestoreTab(["empty:1"], 0)).toBeNull();
  });
});
