// @ts-check
import { describe, it, expect } from "vitest";
import { TERMINAL_SETTINGS_META, DEFAULT_TERMINAL_SETTINGS, sanitizeTerminalSetting, sanitizeTerminalSettings } from "../../ui/utils/terminal-settings.js";

// ── Tests ──

describe("sanitizeTerminalSetting", () => {
  describe("fontSize (number)", () => {
    it("accepts valid integer", () => {
      expect(sanitizeTerminalSetting("fontSize", 14)).toBe(14);
    });

    it("clamps below min to 10", () => {
      expect(sanitizeTerminalSetting("fontSize", 5)).toBe(10);
    });

    it("clamps above max to 24", () => {
      expect(sanitizeTerminalSetting("fontSize", 30)).toBe(24);
    });

    it("rounds float to integer", () => {
      expect(sanitizeTerminalSetting("fontSize", 14.7)).toBe(15);
    });

    it("parses string number", () => {
      expect(sanitizeTerminalSetting("fontSize", "16")).toBe(16);
    });

    it("returns fallback for NaN", () => {
      expect(sanitizeTerminalSetting("fontSize", "abc")).toBe(12);
    });

    it("clamps null (Number(null)=0) to min", () => {
      expect(sanitizeTerminalSetting("fontSize", null)).toBe(10);
    });

    it("returns fallback for undefined (NaN)", () => {
      expect(sanitizeTerminalSetting("fontSize", undefined)).toBe(12);
    });

    it("returns fallback for Infinity", () => {
      expect(sanitizeTerminalSetting("fontSize", Infinity)).toBe(12);
    });
  });

  describe("cursorBlink (boolean)", () => {
    it("accepts true", () => {
      expect(sanitizeTerminalSetting("cursorBlink", true)).toBe(true);
    });

    it("accepts false", () => {
      expect(sanitizeTerminalSetting("cursorBlink", false)).toBe(false);
    });

    it("accepts string 'true'", () => {
      expect(sanitizeTerminalSetting("cursorBlink", "true")).toBe(true);
    });

    it("rejects string 'false'", () => {
      expect(sanitizeTerminalSetting("cursorBlink", "false")).toBe(false);
    });

    it("rejects 1 as not boolean true", () => {
      expect(sanitizeTerminalSetting("cursorBlink", 1)).toBe(false);
    });

    it("returns fallback for undefined (後から追加された設定キーの保存値なし)", () => {
      expect(sanitizeTerminalSetting("cursorBlink", undefined)).toBe(true);
      expect(sanitizeTerminalSetting("copyOnSelect", undefined)).toBe(true);
    });
  });

  describe("cursorStyle (select)", () => {
    it("accepts 'block'", () => {
      expect(sanitizeTerminalSetting("cursorStyle", "block")).toBe("block");
    });

    it("accepts 'underline'", () => {
      expect(sanitizeTerminalSetting("cursorStyle", "underline")).toBe("underline");
    });

    it("accepts 'bar'", () => {
      expect(sanitizeTerminalSetting("cursorStyle", "bar")).toBe("bar");
    });

    it("returns fallback for unknown value", () => {
      expect(sanitizeTerminalSetting("cursorStyle", "unknown")).toBe("block");
    });

    it("returns fallback for undefined", () => {
      expect(sanitizeTerminalSetting("cursorStyle", undefined)).toBe("block");
    });
  });

  describe("unknown key", () => {
    it("returns undefined for unknown key", () => {
      expect(sanitizeTerminalSetting("unknownKey", "whatever")).toBe(undefined);
    });
  });
});

describe("sanitizeTerminalSettings", () => {
  it("returns defaults for all keys when input is empty", () => {
    const result = sanitizeTerminalSettings({});
    expect(result.fontSize).toBe(12);
    expect(result.cursorStyle).toBe("block");
    expect(result.cursorBlink).toBe(true);
    expect(result.scrollOnOutput).toBe(true);
    expect(result.copyOnSelect).toBe(true);
  });

  it("returns same result for null as for empty object", () => {
    const fromNull = sanitizeTerminalSettings(null);
    const fromEmpty = sanitizeTerminalSettings({});
    expect(fromNull).toEqual(fromEmpty);
  });

  it("returns same result for non-object as for empty object", () => {
    const fromStr = sanitizeTerminalSettings("invalid");
    const fromEmpty = sanitizeTerminalSettings({});
    expect(fromStr).toEqual(fromEmpty);
  });

  it("sanitizes valid partial settings", () => {
    const result = sanitizeTerminalSettings({ fontSize: 18, cursorBlink: false });
    expect(result.fontSize).toBe(18);
    expect(result.cursorBlink).toBe(false);
    expect(result.scrollOnOutput).toBe(true);  // boolean: undefined → default
  });

  it("ignores unknown keys", () => {
    const result = sanitizeTerminalSettings({ unknownKey: "value", fontSize: 14 });
    expect(result.fontSize).toBe(14);
    expect(result.unknownKey).toBe(undefined);
  });

  it("clamps out-of-range values", () => {
    const result = sanitizeTerminalSettings({ fontSize: 100 });
    expect(result.fontSize).toBe(24);
  });
});
