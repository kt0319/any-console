// @vitest-environment happy-dom
// @ts-nocheck
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText, isCopyShortcut, copyTerminalSelection } from "../../ui/utils/clipboard.js";

describe("copyText", () => {
  const origClipboard = navigator.clipboard;
  const origExec = document.execCommand;

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: origClipboard, configurable: true });
    document.execCommand = origExec;
    vi.restoreAllMocks();
  });

  function setClipboard(value) {
    Object.defineProperty(navigator, "clipboard", { value, configurable: true });
  }

  // happy-dom に execCommand は無いので直接差し替える。
  function mockExec(result) {
    const fn = vi.fn().mockReturnValue(result);
    document.execCommand = fn;
    return fn;
  }

  it("空文字は false（コピーしない）", async () => {
    expect(await copyText("")).toBe(false);
  });

  it("secure context では navigator.clipboard.writeText を使う", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const ok = await copyText("hello");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("clipboard が無ければ execCommand にフォールバックする", async () => {
    setClipboard(undefined);
    const exec = mockExec(true);
    const ok = await copyText("fallback text");
    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("writeText が失敗したら execCommand にフォールバックする", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboard({ writeText });
    const exec = mockExec(true);
    const ok = await copyText("retry text");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("フォールバックの execCommand が false を返したら false", async () => {
    setClipboard(undefined);
    mockExec(false);
    expect(await copyText("x")).toBe(false);
  });

  it("フォールバック時に textarea を後始末する", async () => {
    setClipboard(undefined);
    mockExec(true);
    await copyText("cleanup");
    expect(document.querySelector("textarea")).toBe(null);
  });
});

describe("isCopyShortcut", () => {
  const ev = (over = {}) => ({
    type: "keydown", key: "c", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...over,
  });
  it("Ctrl+C / Cmd+C / 大文字C を検出する", () => {
    expect(isCopyShortcut(ev())).toBe(true);
    expect(isCopyShortcut(ev({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isCopyShortcut(ev({ key: "C" }))).toBe(true);
  });
  it("Shift/Alt併用・修飾なし・keyup は対象外", () => {
    expect(isCopyShortcut(ev({ shiftKey: true }))).toBe(false);
    expect(isCopyShortcut(ev({ altKey: true }))).toBe(false);
    expect(isCopyShortcut(ev({ ctrlKey: false }))).toBe(false);
    expect(isCopyShortcut(ev({ type: "keyup" }))).toBe(false);
  });
});

describe("copyTerminalSelection", () => {
  it("選択があればコピーして true", () => {
    const term = { hasSelection: () => true, getSelection: () => "hello" };
    expect(copyTerminalSelection(term)).toBe(true);
  });
  it("選択なし・term なしは false", () => {
    expect(copyTerminalSelection({ hasSelection: () => false })).toBe(false);
    expect(copyTerminalSelection(undefined)).toBe(false);
  });
});
