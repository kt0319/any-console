// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { enterViewMode, exitViewMode, isViewMode } from "../../ui/utils/view-mode.js";

function makeFrame() {
  const frame = document.createElement("div");
  document.body.appendChild(frame);
  return frame;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isViewMode", () => {
  it("returns falsy for null", () => {
    expect(isViewMode(null)).toBeFalsy();
  });

  it("returns falsy when class is absent", () => {
    expect(isViewMode(makeFrame())).toBeFalsy();
  });

  it("returns true when view-mode class is set", () => {
    const f = makeFrame();
    f.classList.add("view-mode");
    expect(isViewMode(f)).toBe(true);
  });
});

describe("exitViewMode", () => {
  it("is a no-op when frame is null", () => {
    expect(() => exitViewMode(null)).not.toThrow();
  });

  it("removes view-mode class and pre element", () => {
    const f = makeFrame();
    f.classList.add("view-mode");
    const pre = document.createElement("pre");
    pre.className = "view-mode-textarea";
    f.appendChild(pre);

    exitViewMode(f);

    expect(f.classList.contains("view-mode")).toBe(false);
    expect(f.querySelector(".view-mode-textarea")).toBeNull();
  });

  it("works even when there is no pre", () => {
    const f = makeFrame();
    f.classList.add("view-mode");
    exitViewMode(f);
    expect(f.classList.contains("view-mode")).toBe(false);
  });
});

describe("enterViewMode", () => {
  it("is a no-op when frame is null", async () => {
    await expect(enterViewMode({}, null, vi.fn())).resolves.toBeUndefined();
  });

  it("does nothing if already in view mode", async () => {
    const f = makeFrame();
    f.classList.add("view-mode");
    const apiFetch = vi.fn();
    await enterViewMode({}, f, apiFetch);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("fetches and renders ansi content when wsUrl session is given", async () => {
    const f = makeFrame();
    const apiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: "\x1b[31mhello\x1b[0m" }),
    });

    await enterViewMode({ wsUrl: "wss://h/terminal/ws/abc123" }, f, apiFetch);

    expect(apiFetch).toHaveBeenCalledOnce();
    expect(f.classList.contains("view-mode")).toBe(true);
    const pre = f.querySelector(".view-mode-textarea");
    expect(pre).not.toBeNull();
    expect(pre.innerHTML).toContain("hello");
  });

  it("falls back to terminalBufferToHtml when fetch fails", async () => {
    const f = makeFrame();
    const apiFetch = vi.fn().mockRejectedValue(new Error("boom"));
    const fakeCell = {
      getChars: () => "x",
      getWidth: () => 1,
      isFgPalette: () => false,
      isBgPalette: () => false,
      isFgRGB: () => false,
      isBgRGB: () => false,
      getFgColor: () => 0,
      getBgColor: () => 0,
      isBold: () => false,
      isDim: () => false,
      isItalic: () => false,
      isUnderline: () => false,
      isStrikethrough: () => false,
    };
    const fakeLine = { length: 1, getCell: () => fakeCell };
    const fakeTerm = { buffer: { active: { length: 1, getLine: () => fakeLine } } };

    await enterViewMode({ wsUrl: "wss://h/terminal/ws/abc", term: fakeTerm }, f, apiFetch);

    const pre = f.querySelector(".view-mode-textarea");
    expect(pre).not.toBeNull();
    expect(pre.innerHTML).toContain("x");
  });

  it("hides the keyboard wrapper if present", async () => {
    const kb = document.createElement("div");
    kb.className = "keyboard-input-wrapper";
    document.body.appendChild(kb);
    const f = makeFrame();

    await enterViewMode({ wsUrl: null }, f, vi.fn());

    expect(kb.style.display).toBe("none");
  });
});
