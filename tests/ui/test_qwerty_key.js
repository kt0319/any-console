// @ts-check
import { describe, it, expect } from "vitest";
import {
  qwertyDisplayLabel,
  qwertySymbolLabel,
  qwertyHasFlick,
  qwertyFlickUpLabel,
  resolveQwertyVerticalFlick,
  resolveFnNumberKey,
} from "../../ui/utils/qwerty-key.ts";
import { QWERTY_FLICK_THRESHOLD } from "../../ui/utils/constants.ts";

describe("qwertyDisplayLabel", () => {
  it("returns label when shift is off", () => {
    expect(qwertyDisplayLabel({ label: "q", key: "q" }, false)).toBe("q");
  });

  it("uppercases single-char key when shift is on", () => {
    expect(qwertyDisplayLabel({ label: "q", key: "q" }, true)).toBe("Q");
  });

  it("keeps label for multi-char keys even with shift", () => {
    expect(qwertyDisplayLabel({ label: "Tab", key: "Tab" }, true)).toBe("Tab");
  });

  it("falls back to key when label is missing", () => {
    expect(qwertyDisplayLabel({ key: "x" }, false)).toBe("x");
  });
});

describe("qwertySymbolLabel", () => {
  it("shows flickUp symbol in symbol view", () => {
    expect(qwertySymbolLabel({ label: "q", key: "q", flickUp: "!" }, false, true)).toBe("!");
  });

  it("keeps display label for noSymbol keys in symbol view", () => {
    expect(qwertySymbolLabel({ label: "⌫", key: "Backspace", flickUp: "Delete", noSymbol: true }, false, true)).toBe("⌫");
  });

  it("keeps display label when symbol view is off", () => {
    expect(qwertySymbolLabel({ label: "q", key: "q", flickUp: "!" }, false, false)).toBe("q");
  });

  it("applies shift uppercase when symbol view is off", () => {
    expect(qwertySymbolLabel({ label: "q", key: "q", flickUp: "!" }, true, false)).toBe("Q");
  });
});

describe("qwertyHasFlick", () => {
  it("is true with flickUp", () => {
    expect(qwertyHasFlick({ key: "q", flickUp: "!" })).toBe(true);
  });

  it("is true with flickDown only", () => {
    expect(qwertyHasFlick({ key: "g", flickDown: "{" })).toBe(true);
  });

  it("is false without flick definitions", () => {
    expect(qwertyHasFlick({ key: "Home" })).toBe(false);
  });
});

describe("qwertyFlickUpLabel", () => {
  it("prefers flickUpLabel", () => {
    expect(qwertyFlickUpLabel({ flickUp: "Delete", flickUpLabel: "Del" })).toBe("Del");
  });

  it("falls back to flickUp", () => {
    expect(qwertyFlickUpLabel({ flickUp: "!" })).toBe("!");
  });

  it("returns empty string without flickUp", () => {
    expect(qwertyFlickUpLabel({ key: "q" })).toBe("");
  });
});

describe("resolveQwertyVerticalFlick", () => {
  const keyDef = { key: "g", flickUp: "[", flickDown: "{" };

  it("resolves flickUp on upward flick beyond threshold", () => {
    expect(resolveQwertyVerticalFlick(-(QWERTY_FLICK_THRESHOLD + 1), keyDef)).toEqual({ key: "[" });
  });

  it("resolves flickDown on downward flick beyond threshold", () => {
    expect(resolveQwertyVerticalFlick(QWERTY_FLICK_THRESHOLD + 1, keyDef)).toEqual({ key: "{" });
  });

  it("treats movement at threshold as tap", () => {
    expect(resolveQwertyVerticalFlick(-QWERTY_FLICK_THRESHOLD, keyDef)).toBeNull();
    expect(resolveQwertyVerticalFlick(QWERTY_FLICK_THRESHOLD, keyDef)).toBeNull();
  });

  it("treats small movement as tap", () => {
    expect(resolveQwertyVerticalFlick(5, keyDef)).toBeNull();
  });

  it("consumes upward flick without sending when only flickDown exists", () => {
    expect(resolveQwertyVerticalFlick(-(QWERTY_FLICK_THRESHOLD + 1), { key: "g", flickDown: "{" })).toEqual({ key: null });
  });

  it("treats downward flick without flickDown as tap", () => {
    expect(resolveQwertyVerticalFlick(QWERTY_FLICK_THRESHOLD + 1, { key: "q", flickUp: "!" })).toBeNull();
  });

  it("treats keys without flicks as tap", () => {
    expect(resolveQwertyVerticalFlick(-100, { key: "Home" })).toBeNull();
  });
});

describe("resolveFnNumberKey", () => {
  const keyDef = { key: "1", flickUp: "F1" };

  it("resolves F-key on upward flick beyond threshold", () => {
    expect(resolveFnNumberKey(-(QWERTY_FLICK_THRESHOLD + 1), keyDef)).toBe("F1");
  });

  it("resolves the number key on tap", () => {
    expect(resolveFnNumberKey(0, keyDef)).toBe("1");
  });

  it("treats movement at threshold as tap", () => {
    expect(resolveFnNumberKey(-QWERTY_FLICK_THRESHOLD, keyDef)).toBe("1");
  });

  it("ignores upward flick without flickUp", () => {
    expect(resolveFnNumberKey(-100, { key: "0" })).toBe("0");
  });
});
