import { describe, it, expect } from "vitest";
import { normalizeLayoutPrefs, resolveTabPosition, resolveKeyboardBarVisible, resolveTitleBarVisible, DEFAULT_LAYOUT_PREFS } from "../../ui/utils/layout-prefs.ts";

describe("normalizeLayoutPrefs", () => {
  it("nullの場合は既定値をそのまま返す", () => {
    expect(normalizeLayoutPrefs(null)).toEqual(DEFAULT_LAYOUT_PREFS);
  });

  it("不正な値は既定値にフォールバックする", () => {
    expect(normalizeLayoutPrefs({ narrowTabPosition: "left", wideKeyboardBar: "yes", wideTitleBar: "yes" })).toEqual(DEFAULT_LAYOUT_PREFS);
  });

  it("正しい値はそのまま採用する", () => {
    expect(normalizeLayoutPrefs({
      narrowTabPosition: "top",
      wideTabPosition: "bottom",
      narrowKeyboardBar: false,
      wideKeyboardBar: true,
      narrowTitleBar: false,
      wideTitleBar: true,
    })).toEqual({
      narrowTabPosition: "top",
      wideTabPosition: "bottom",
      narrowKeyboardBar: false,
      wideKeyboardBar: true,
      narrowTitleBar: false,
      wideTitleBar: true,
    });
  });

  it("部分的な値は既定値とマージする", () => {
    expect(normalizeLayoutPrefs({ narrowTabPosition: "top" })).toEqual({
      ...DEFAULT_LAYOUT_PREFS,
      narrowTabPosition: "top",
    });
  });
});

describe("resolveTabPosition / resolveKeyboardBarVisible / resolveTitleBarVisible", () => {
  it("既定値では、狭い時はbottom+表示、広い時はtop+非表示になる（現行の自動判定と一致）", () => {
    expect(resolveTabPosition(DEFAULT_LAYOUT_PREFS, true)).toBe("bottom");
    expect(resolveTabPosition(DEFAULT_LAYOUT_PREFS, false)).toBe("top");
    expect(resolveKeyboardBarVisible(DEFAULT_LAYOUT_PREFS, true)).toBe(true);
    expect(resolveKeyboardBarVisible(DEFAULT_LAYOUT_PREFS, false)).toBe(false);
    expect(resolveTitleBarVisible(DEFAULT_LAYOUT_PREFS, true)).toBe(true);
    expect(resolveTitleBarVisible(DEFAULT_LAYOUT_PREFS, false)).toBe(false);
  });

  it("狭い/広いそれぞれ個別に設定した値を反映する", () => {
    const prefs = {
      narrowTabPosition: "top", wideTabPosition: "top",
      narrowKeyboardBar: false, wideKeyboardBar: true,
      narrowTitleBar: false, wideTitleBar: true,
    };
    expect(resolveTabPosition(prefs, true)).toBe("top");
    expect(resolveTabPosition(prefs, false)).toBe("top");
    expect(resolveKeyboardBarVisible(prefs, true)).toBe(false);
    expect(resolveKeyboardBarVisible(prefs, false)).toBe(true);
    expect(resolveTitleBarVisible(prefs, true)).toBe(false);
    expect(resolveTitleBarVisible(prefs, false)).toBe(true);
  });
});
