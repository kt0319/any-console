// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi } from "vitest";
import { listenForEscape, isCaretOnFirstLine, isCaretOnLastLine } from "../../ui/utils/keyboard.js";

function dispatchKeydown(key) {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe("listenForEscape", () => {
  it("invokes handler on Escape keydown", () => {
    const handler = vi.fn();
    const release = listenForEscape(handler);
    dispatchKeydown("Escape");
    expect(handler).toHaveBeenCalledTimes(1);
    release();
  });

  it("ignores non-Escape keys", () => {
    const handler = vi.fn();
    const release = listenForEscape(handler);
    dispatchKeydown("Enter");
    dispatchKeydown("a");
    expect(handler).not.toHaveBeenCalled();
    release();
  });

  it("calls preventDefault on Escape", () => {
    const release = listenForEscape(() => {});
    const event = dispatchKeydown("Escape");
    expect(event.defaultPrevented).toBe(true);
    release();
  });

  it("does not call preventDefault on other keys", () => {
    const release = listenForEscape(() => {});
    const event = dispatchKeydown("Enter");
    expect(event.defaultPrevented).toBe(false);
    release();
  });

  it("release() stops further invocations", () => {
    const handler = vi.fn();
    const release = listenForEscape(handler);
    release();
    dispatchKeydown("Escape");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("isCaretOnFirstLine / isCaretOnLastLine", () => {
  it("単一行では常に最初かつ最後の行", () => {
    expect(isCaretOnFirstLine("hello", 3)).toBe(true);
    expect(isCaretOnLastLine("hello", 3)).toBe(true);
  });

  it("複数行の先頭行にいる時だけ first line", () => {
    const value = "line1\nline2";
    expect(isCaretOnFirstLine(value, 0)).toBe(true);
    expect(isCaretOnFirstLine(value, 5)).toBe(true); // line1 の末尾
    expect(isCaretOnFirstLine(value, 6)).toBe(false); // line2 の先頭
    expect(isCaretOnFirstLine(value, 11)).toBe(false);
  });

  it("複数行の最終行にいる時だけ last line", () => {
    const value = "line1\nline2";
    expect(isCaretOnLastLine(value, 11)).toBe(true);
    expect(isCaretOnLastLine(value, 6)).toBe(true); // line2 の先頭
    expect(isCaretOnLastLine(value, 5)).toBe(false); // 改行より前
    expect(isCaretOnLastLine(value, 0)).toBe(false);
  });

  it("selection が null/undefined の時は先頭/末尾として扱う", () => {
    const value = "line1\nline2";
    expect(isCaretOnFirstLine(value, null)).toBe(true);
    expect(isCaretOnLastLine(value, null)).toBe(true);
    expect(isCaretOnFirstLine(value, undefined)).toBe(true);
    expect(isCaretOnLastLine(value, undefined)).toBe(true);
  });

  it("空文字列ではどちらも true", () => {
    expect(isCaretOnFirstLine("", 0)).toBe(true);
    expect(isCaretOnLastLine("", 0)).toBe(true);
  });
});
