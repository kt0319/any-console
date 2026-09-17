import { describe, it, expect } from "vitest";
import { normalizeLayoutPrefs, resolveTabPosition, resolveKeyboardBarVisible, resolveKeyboardBarFullWidth, resolveTitleBarPosition, resolveInfoPillDisplayMode, isInfoPillBarMode, DEFAULT_LAYOUT_PREFS } from "../../ui/utils/layout-prefs.ts";

describe("normalizeLayoutPrefs", () => {
  it("nullの場合は既定値をそのまま返す", () => {
    expect(normalizeLayoutPrefs(null)).toEqual(DEFAULT_LAYOUT_PREFS);
  });

  it("不正な値は既定値にフォールバックする", () => {
    expect(normalizeLayoutPrefs({ narrowTabPosition: "left", wideKeyboardBarMode: "yes", wideTitleBarPosition: "left" })).toEqual(DEFAULT_LAYOUT_PREFS);
  });

  it("正しい値はそのまま採用する", () => {
    expect(normalizeLayoutPrefs({
      narrowTabPosition: "top",
      wideTabPosition: "bottom",
      narrowKeyboardBar: false,
      wideKeyboardBarMode: "full",
      narrowTitleBarPosition: "top",
      wideTitleBarPosition: "bottom",
      narrowInfoPillMode: "bar-bottom",
      wideInfoPillMode: "off",
    })).toEqual({
      narrowTabPosition: "top",
      wideTabPosition: "bottom",
      narrowKeyboardBar: false,
      wideKeyboardBarMode: "full",
      narrowTitleBarPosition: "top",
      wideTitleBarPosition: "bottom",
      narrowInfoPillMode: "bar-bottom",
      wideInfoPillMode: "off",
    });
  });

  it("infoPillModeの不正な値は既定値にフォールバックする", () => {
    expect(normalizeLayoutPrefs({ narrowInfoPillMode: "invalid", wideInfoPillMode: 123 })).toEqual(DEFAULT_LAYOUT_PREFS);
  });

  it("旧バージョンの'bar'（位置選択が無かった頃の値）はbar-topへ読み替える", () => {
    expect(normalizeLayoutPrefs({ narrowInfoPillMode: "bar", wideInfoPillMode: "bar" })).toEqual({
      ...DEFAULT_LAYOUT_PREFS,
      narrowInfoPillMode: "bar-top",
      wideInfoPillMode: "bar-top",
    });
  });

  it("旧バージョンの'float'（位置選択が無かった頃の値）は既定の見た目（narrow=bottom/wide=top）を保つよう読み替える", () => {
    expect(normalizeLayoutPrefs({ narrowInfoPillMode: "float", wideInfoPillMode: "float" })).toEqual({
      ...DEFAULT_LAYOUT_PREFS,
      narrowInfoPillMode: "float-bottom",
      wideInfoPillMode: "float-top",
    });
  });

  it("部分的な値は既定値とマージする", () => {
    expect(normalizeLayoutPrefs({ narrowTabPosition: "top" })).toEqual({
      ...DEFAULT_LAYOUT_PREFS,
      narrowTabPosition: "top",
    });
  });
});

describe("resolveTabPosition / resolveKeyboardBarVisible / resolveKeyboardBarFullWidth / resolveTitleBarPosition", () => {
  it("既定値では、狭い時はbottomタブ+Bottomタイトルバー、広い時はtopタブ+タイトルバーoffになる（現行の自動判定と一致）", () => {
    expect(resolveTabPosition(DEFAULT_LAYOUT_PREFS, true)).toBe("bottom");
    expect(resolveTabPosition(DEFAULT_LAYOUT_PREFS, false)).toBe("top");
    expect(resolveKeyboardBarVisible(DEFAULT_LAYOUT_PREFS, true)).toBe(true);
    expect(resolveKeyboardBarVisible(DEFAULT_LAYOUT_PREFS, false)).toBe(false);
    expect(resolveTitleBarPosition(DEFAULT_LAYOUT_PREFS, true)).toBe("bottom");
    expect(resolveTitleBarPosition(DEFAULT_LAYOUT_PREFS, false)).toBe("off");
  });

  it("タブ位置とタイトルバー位置は独立して設定できる（タブ=bottomでもタイトルバー=topにできる）", () => {
    const prefs = {
      narrowTabPosition: "bottom", wideTabPosition: "top",
      narrowKeyboardBar: false, wideKeyboardBarMode: "sidebar",
      narrowTitleBarPosition: "top", wideTitleBarPosition: "bottom",
    };
    expect(resolveTabPosition(prefs, true)).toBe("bottom");
    expect(resolveTitleBarPosition(prefs, true)).toBe("top");
    expect(resolveTabPosition(prefs, false)).toBe("top");
    expect(resolveTitleBarPosition(prefs, false)).toBe("bottom");
  });

  it("wideKeyboardBarModeがfullなら表示+フル幅、sidebarなら表示+サイドバー分縮小、offなら非表示", () => {
    const full = { ...DEFAULT_LAYOUT_PREFS, wideKeyboardBarMode: "full" };
    const sidebar = { ...DEFAULT_LAYOUT_PREFS, wideKeyboardBarMode: "sidebar" };
    const off = { ...DEFAULT_LAYOUT_PREFS, wideKeyboardBarMode: "off" };
    expect(resolveKeyboardBarVisible(full, false)).toBe(true);
    expect(resolveKeyboardBarFullWidth(full, false)).toBe(true);
    expect(resolveKeyboardBarVisible(sidebar, false)).toBe(true);
    expect(resolveKeyboardBarFullWidth(sidebar, false)).toBe(false);
    expect(resolveKeyboardBarVisible(off, false)).toBe(false);
  });

  it("狭い画面ではセッションサイドバーが無いため常にフル幅扱いになる", () => {
    expect(resolveKeyboardBarFullWidth(DEFAULT_LAYOUT_PREFS, true)).toBe(true);
  });

  it("Info Pillsの表示モードは狭い/広い画面で独立して設定できる", () => {
    const prefs = { ...DEFAULT_LAYOUT_PREFS, narrowInfoPillMode: "off", wideInfoPillMode: "bar-bottom" };
    expect(resolveInfoPillDisplayMode(prefs, true)).toBe("off");
    expect(resolveInfoPillDisplayMode(prefs, false)).toBe("bar-bottom");
  });

  it("既定値のInfo Pillsは、位置選択制になる前の自動追従（狭い=bottom/広い=top）と同じ見た目になる", () => {
    expect(resolveInfoPillDisplayMode(DEFAULT_LAYOUT_PREFS, true)).toBe("float-bottom");
    expect(resolveInfoPillDisplayMode(DEFAULT_LAYOUT_PREFS, false)).toBe("float-top");
  });
});

describe("isInfoPillBarMode", () => {
  it("bar-top/bar-bottomはtrue", () => {
    expect(isInfoPillBarMode("bar-top")).toBe(true);
    expect(isInfoPillBarMode("bar-bottom")).toBe(true);
  });

  it("off/float-top/float-bottomはfalse", () => {
    expect(isInfoPillBarMode("off")).toBe(false);
    expect(isInfoPillBarMode("float-top")).toBe(false);
    expect(isInfoPillBarMode("float-bottom")).toBe(false);
  });
});
