// @ts-check
import { describe, it, expect } from "vitest";
import {
  CIRCLE_KEYPAD_MODIFIER_OPTIONS,
  CIRCLE_KEYPAD_BASE_KEYS,
  CIRCLE_KEYPAD_SPECIAL_PRESETS,
  CIRCLE_KEYPAD_DIRECTION_LABELS,
  CIRCLE_KEYPAD_CORNER_LABELS,
  DEFAULT_CIRCLE_KEYPAD_KEY_DEFS,
  DEFAULT_CIRCLE_KEYPAD_SPECIALS,
  findModifierOption,
  findBaseKey,
  findSpecialPreset,
  modifierIdOf,
  baseKeyIdOf,
  circleKeypadKeyLabel,
  defaultKeyDefs,
  defaultSpecialDefs,
} from "../../ui/utils/circle-keypad-presets.ts";

describe("CIRCLE_KEYPAD_* metadata", () => {
  it("has 8 direction labels", () => {
    expect(CIRCLE_KEYPAD_DIRECTION_LABELS).toHaveLength(8);
  });

  it("has 4 corner labels", () => {
    expect(CIRCLE_KEYPAD_CORNER_LABELS).toHaveLength(4);
  });

  it("default key def list matches direction count", () => {
    expect(DEFAULT_CIRCLE_KEYPAD_KEY_DEFS).toHaveLength(8);
  });

  it("default special list matches corner count", () => {
    expect(DEFAULT_CIRCLE_KEYPAD_SPECIALS).toHaveLength(4);
  });

  it("every default key def resolves to a known modifier and base key", () => {
    for (const { modifier, key } of DEFAULT_CIRCLE_KEYPAD_KEY_DEFS) {
      expect(findModifierOption(modifier)).toBeTruthy();
      expect(findBaseKey(key)).not.toBeNull();
    }
  });

  it("every default special id resolves to a preset", () => {
    for (const id of DEFAULT_CIRCLE_KEYPAD_SPECIALS) {
      expect(findSpecialPreset(id)).not.toBeNull();
    }
  });

  it("modifier options cover the ctrl/shift/alt combinations", () => {
    expect(CIRCLE_KEYPAD_MODIFIER_OPTIONS).toHaveLength(8);
    const none = CIRCLE_KEYPAD_MODIFIER_OPTIONS.find((m) => m.id === "none");
    expect(none.ctrl).toBe(false);
    expect(none.shift).toBe(false);
    expect(none.alt).toBe(false);
    const all = CIRCLE_KEYPAD_MODIFIER_OPTIONS.find((m) => m.id === "ctrl_shift_alt");
    expect(all.ctrl).toBe(true);
    expect(all.shift).toBe(true);
    expect(all.alt).toBe(true);
  });

  it("base keys include arrows, letters, digits, and special keys", () => {
    expect(CIRCLE_KEYPAD_BASE_KEYS.some((k) => k.id === "ArrowUp")).toBe(true);
    expect(CIRCLE_KEYPAD_BASE_KEYS.some((k) => k.id === "a")).toBe(true);
    expect(CIRCLE_KEYPAD_BASE_KEYS.some((k) => k.id === "z")).toBe(true);
    expect(CIRCLE_KEYPAD_BASE_KEYS.some((k) => k.id === "PageUp")).toBe(true);
    for (let i = 0; i <= 9; i++) {
      const digit = CIRCLE_KEYPAD_BASE_KEYS.find((k) => k.id === String(i));
      expect(digit).toBeTruthy();
      expect(digit.label).toBe(String(i));
    }
  });
});

describe("findModifierOption / findBaseKey / findSpecialPreset", () => {
  it("returns null for unknown base key / special id", () => {
    expect(findBaseKey("no-such")).toBeNull();
    expect(findSpecialPreset("no-such")).toBeNull();
  });

  it("falls back to none for unknown modifier id", () => {
    expect(findModifierOption("no-such").id).toBe("none");
  });

  it("returns matching entries", () => {
    expect(findModifierOption("ctrl").ctrl).toBe(true);
    expect(findBaseKey("ArrowUp")?.id).toBe("ArrowUp");
    expect(findSpecialPreset("selcopy")?.action).toBe("selection:open");
  });
});

describe("modifierIdOf / baseKeyIdOf", () => {
  it("resolves modifier id from ctrl/shift/alt flags", () => {
    expect(modifierIdOf({ ctrl: false, shift: false, alt: false })).toBe("none");
    expect(modifierIdOf({ ctrl: true, shift: false, alt: false })).toBe("ctrl");
    expect(modifierIdOf({ ctrl: true, shift: true, alt: true })).toBe("ctrl_shift_alt");
  });

  it("resolves base key id or empty string for unknown key", () => {
    expect(baseKeyIdOf({ key: "ArrowUp" })).toBe("ArrowUp");
    expect(baseKeyIdOf({ key: "no-such" })).toBe("");
  });
});

describe("circleKeypadKeyLabel", () => {
  it("returns bare key label when modifier is none", () => {
    expect(circleKeypadKeyLabel("none", "ArrowUp")).toBe("↑");
  });

  it("prefixes modifier symbol otherwise (compact for ring display)", () => {
    expect(circleKeypadKeyLabel("ctrl", "c")).toBe("⌃C");
    expect(circleKeypadKeyLabel("ctrl_alt", "a")).toBe("⌃⌥A");
  });
});

describe("defaultKeyDefs / defaultSpecialDefs", () => {
  it("returns 8 normalized key entries with ctrl/shift/alt booleans", () => {
    const defs = defaultKeyDefs();
    expect(defs).toHaveLength(8);
    for (const d of defs) {
      expect(typeof d.key).toBe("string");
      expect(typeof d.ctrl).toBe("boolean");
      expect(typeof d.shift).toBe("boolean");
      expect(typeof d.alt).toBe("boolean");
      expect(typeof d.label).toBe("string");
    }
  });

  it("Ctrl+C entry has ctrl=true", () => {
    const defs = defaultKeyDefs();
    const ctrlc = defs.find((d) => d.key === "c" && d.ctrl);
    expect(ctrlc).toBeTruthy();
  });

  it("returns 4 normalized special entries", () => {
    const defs = defaultSpecialDefs();
    expect(defs).toHaveLength(4);
    for (const d of defs) {
      expect(typeof d.label).toBe("string");
      expect(typeof d.action).toBe("string");
    }
  });
});

describe("CIRCLE_KEYPAD_SPECIAL_PRESETS entries", () => {
  it("each entry has id/label/action", () => {
    for (const p of CIRCLE_KEYPAD_SPECIAL_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.action).toBe("string");
    }
  });

  it("includes a 'none' preset with an empty action (hides the corner button)", () => {
    const none = findSpecialPreset("none");
    expect(none).not.toBeNull();
    expect(none.action).toBe("");
  });
});
