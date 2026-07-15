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

  it("encodes ctrl modifier for arrow / Home / End keys", () => {
    expect(keyDefToAnsi({ key: "End", ctrl: true })).toBe("\x1b[1;5F");
    expect(keyDefToAnsi({ key: "Home", ctrl: true })).toBe("\x1b[1;5H");
    expect(keyDefToAnsi({ key: "ArrowRight", ctrl: true })).toBe("\x1b[1;5C");
    expect(keyDefToAnsi({ key: "ArrowLeft", ctrl: true })).toBe("\x1b[1;5D");
  });

  it("encodes shift and shift+ctrl modifiers", () => {
    expect(keyDefToAnsi({ key: "End", shift: true })).toBe("\x1b[1;2F");
    expect(keyDefToAnsi({ key: "End", ctrl: true, shift: true })).toBe("\x1b[1;6F");
  });

  it("encodes modifiers for tilde-form keys (Page/Insert/Delete/F5+)", () => {
    expect(keyDefToAnsi({ key: "PageUp", ctrl: true })).toBe("\x1b[5;5~");
    expect(keyDefToAnsi({ key: "PageDown", ctrl: true })).toBe("\x1b[6;5~");
    expect(keyDefToAnsi({ key: "Delete", ctrl: true })).toBe("\x1b[3;5~");
    expect(keyDefToAnsi({ key: "F5", ctrl: true })).toBe("\x1b[15;5~");
  });

  it("maps F1-F4 as SS3 unmodified and CSI when modified", () => {
    expect(keyDefToAnsi({ key: "F1" })).toBe("\x1bOP");
    expect(keyDefToAnsi({ key: "F1", ctrl: true })).toBe("\x1b[1;5P");
  });

  it("keeps unmodified special keys backward compatible", () => {
    expect(keyDefToAnsi({ key: "End" })).toBe("\x1b[F");
    expect(keyDefToAnsi({ key: "Home" })).toBe("\x1b[H");
    expect(keyDefToAnsi({ key: "PageUp" })).toBe("\x1b[5~");
    expect(keyDefToAnsi({ key: "Delete" })).toBe("\x1b[3~");
  });

  it("prefixes ESC for alt on printable chars (meta-sends-escape)", () => {
    expect(keyDefToAnsi({ key: "a", alt: true })).toBe("\x1ba");
    expect(keyDefToAnsi({ key: "a", alt: true, shift: true })).toBe("\x1bA");
  });

  it("prefixes ESC for alt on control-code letters", () => {
    expect(keyDefToAnsi({ key: "c", ctrl: true, alt: true })).toBe("\x1b\x03");
  });

  it("prefixes ESC for alt on special keys via table", () => {
    expect(keyDefToAnsi({ key: "Backspace", alt: true })).toBe("\x1b\x7f");
    expect(keyDefToAnsi({ key: "Enter", alt: true })).toBe("\x1b\r");
  });

  it("folds alt into the CSI modifier parameter for arrow/tilde/SS3 keys", () => {
    expect(keyDefToAnsi({ key: "ArrowUp", alt: true })).toBe("\x1b[1;3A");
    expect(keyDefToAnsi({ key: "PageUp", alt: true })).toBe("\x1b[5;3~");
    expect(keyDefToAnsi({ key: "F1", alt: true })).toBe("\x1b[1;3P");
    expect(keyDefToAnsi({ key: "ArrowLeft", ctrl: true, alt: true })).toBe("\x1b[1;7D");
  });
});
