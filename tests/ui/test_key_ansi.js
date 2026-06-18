// @ts-check
import { describe, it, expect } from "vitest";
import { keyDefToAnsi } from "../../ui/utils/key-ansi.js";

describe("keyDefToAnsi", () => {
  it("converts ctrl + letter to control byte", () => {
    expect(keyDefToAnsi({ key: "c", ctrl: true })).toBe("\x03");
    expect(keyDefToAnsi({ key: "A", ctrl: true })).toBe("\x01");
  });

  it("falls through to literal char when ctrl is given with non-letter", () => {
    // ctrl 補正は a-z のみ。それ以外は通常マッピングへフォールバックする。
    expect(keyDefToAnsi({ key: "1", ctrl: true })).toBe("1");
  });

  it("converts shift+Tab to back-tab", () => {
    expect(keyDefToAnsi({ key: "Tab", shift: true })).toBe("\x1b[Z");
  });

  it("converts shift+Enter to LF", () => {
    expect(keyDefToAnsi({ key: "Enter", shift: true })).toBe("\n");
  });

  it("uppercases printable char on shift", () => {
    expect(keyDefToAnsi({ key: "a", shift: true })).toBe("A");
  });

  it("maps special keys via table", () => {
    expect(keyDefToAnsi({ key: "Enter" })).toBe("\r");
    expect(keyDefToAnsi({ key: "Tab" })).toBe("\t");
    expect(keyDefToAnsi({ key: "Escape" })).toBe("\x1b");
    expect(keyDefToAnsi({ key: "Backspace" })).toBe("\x7f");
    expect(keyDefToAnsi({ key: "ArrowUp" })).toBe("\x1b[A");
    expect(keyDefToAnsi({ key: "ArrowDown" })).toBe("\x1b[B");
    expect(keyDefToAnsi({ key: "ArrowRight" })).toBe("\x1b[C");
    expect(keyDefToAnsi({ key: "ArrowLeft" })).toBe("\x1b[D");
    expect(keyDefToAnsi({ key: "F5" })).toBe("\x1b[15~");
  });

  it("returns single character as-is when not mapped", () => {
    expect(keyDefToAnsi({ key: "x" })).toBe("x");
  });

  it("returns null for unknown multi-char keys", () => {
    expect(keyDefToAnsi({ key: "Unknown" })).toBe(null);
  });
});
