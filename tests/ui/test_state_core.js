// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline copies of pure functions from state-core.js ──
// These are copied here because the source module depends on browser globals
// (window, localStorage, matchMedia) that aren't available in Node.

const TERMINAL_SETTINGS_SCHEMA = Object.freeze({
  fontSize: { type: "number", min: 10, max: 24, step: 1 },
  cursorBlink: { type: "boolean" },
  scrollback: { type: "number", min: 1000, max: 20000, step: 500 },
  scrollOnOutput: { type: "boolean" },
});

const DEFAULT_TERMINAL_SETTINGS = Object.freeze({
  fontSize: 12,
  cursorBlink: true,
  scrollback: 5000,
  scrollOnOutput: true,
});

function sanitizeTerminalSetting(key, value) {
  const schema = TERMINAL_SETTINGS_SCHEMA[key];
  const fallback = DEFAULT_TERMINAL_SETTINGS[key];
  if (!schema) return fallback;
  if (schema.type === "boolean") return value === true || value === "true";
  if (schema.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const rounded = schema.step && schema.step >= 1 ? Math.round(num) : num;
    return Math.min(schema.max, Math.max(schema.min, rounded));
  }
  return fallback;
}

function sanitizeTerminalSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const next = {};
  for (const key of Object.keys(DEFAULT_TERMINAL_SETTINGS)) {
    next[key] = sanitizeTerminalSetting(key, source[key]);
  }
  return next;
}

// ── Tests ──

describe("sanitizeTerminalSetting", () => {
  describe("fontSize (number)", () => {
    it("accepts valid integer", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", 14), 14);
    });

    it("clamps below min to 10", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", 5), 10);
    });

    it("clamps above max to 24", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", 30), 24);
    });

    it("rounds float to integer", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", 14.7), 15);
    });

    it("parses string number", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", "16"), 16);
    });

    it("returns fallback for NaN", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", "abc"), 12);
    });

    it("clamps null (Number(null)=0) to min", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", null), 10);
    });

    it("returns fallback for undefined (NaN)", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", undefined), 12);
    });

    it("returns fallback for Infinity", () => {
      assert.equal(sanitizeTerminalSetting("fontSize", Infinity), 12);
    });
  });

  describe("cursorBlink (boolean)", () => {
    it("accepts true", () => {
      assert.equal(sanitizeTerminalSetting("cursorBlink", true), true);
    });

    it("accepts false", () => {
      assert.equal(sanitizeTerminalSetting("cursorBlink", false), false);
    });

    it("accepts string 'true'", () => {
      assert.equal(sanitizeTerminalSetting("cursorBlink", "true"), true);
    });

    it("rejects string 'false'", () => {
      assert.equal(sanitizeTerminalSetting("cursorBlink", "false"), false);
    });

    it("rejects 1 as not boolean true", () => {
      assert.equal(sanitizeTerminalSetting("cursorBlink", 1), false);
    });
  });

  describe("scrollback (number)", () => {
    it("accepts valid value", () => {
      assert.equal(sanitizeTerminalSetting("scrollback", 3000), 3000);
    });

    it("clamps below min", () => {
      assert.equal(sanitizeTerminalSetting("scrollback", 500), 1000);
    });

    it("clamps above max", () => {
      assert.equal(sanitizeTerminalSetting("scrollback", 25000), 20000);
    });
  });

  describe("unknown key", () => {
    it("returns undefined for unknown key", () => {
      assert.equal(sanitizeTerminalSetting("unknownKey", "whatever"), undefined);
    });
  });
});

describe("sanitizeTerminalSettings", () => {
  it("returns number defaults but false for booleans when input is empty", () => {
    // Boolean sanitizer treats undefined as false, not as default
    const result = sanitizeTerminalSettings({});
    assert.equal(result.fontSize, 12);
    assert.equal(result.cursorBlink, false);
    assert.equal(result.scrollback, 5000);
    assert.equal(result.scrollOnOutput, false);
  });

  it("returns same result for null as for empty object", () => {
    const fromNull = sanitizeTerminalSettings(null);
    const fromEmpty = sanitizeTerminalSettings({});
    assert.deepEqual(fromNull, fromEmpty);
  });

  it("returns same result for non-object as for empty object", () => {
    const fromStr = sanitizeTerminalSettings("invalid");
    const fromEmpty = sanitizeTerminalSettings({});
    assert.deepEqual(fromStr, fromEmpty);
  });

  it("sanitizes valid partial settings", () => {
    const result = sanitizeTerminalSettings({ fontSize: 18, cursorBlink: false });
    assert.equal(result.fontSize, 18);
    assert.equal(result.cursorBlink, false);
    assert.equal(result.scrollback, 5000);  // number fallback
    assert.equal(result.scrollOnOutput, false);  // boolean: undefined → false
  });

  it("ignores unknown keys", () => {
    const result = sanitizeTerminalSettings({ unknownKey: "value", fontSize: 14 });
    assert.equal(result.fontSize, 14);
    assert.equal(result.unknownKey, undefined);
  });

  it("clamps out-of-range values", () => {
    const result = sanitizeTerminalSettings({ fontSize: 100, scrollback: -5 });
    assert.equal(result.fontSize, 24);
    assert.equal(result.scrollback, 1000);
  });
});
