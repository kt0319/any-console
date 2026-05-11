// @ts-check
import { describe, it, expect } from "vitest";
import { ansiToHtml } from "../../ui/utils/view-mode.js";

describe("ansiToHtml", () => {
  it("returns plain text untouched (HTML-escaped)", () => {
    expect(ansiToHtml("hello <world>")).toBe("hello &lt;world&gt;");
  });

  it("renders red foreground (\\x1b[31m)", () => {
    const out = ansiToHtml("\x1b[31mred\x1b[0m");
    expect(out).toContain("color:");
    expect(out).toContain("red");
  });

  it("renders bold text", () => {
    const out = ansiToHtml("\x1b[1mbold\x1b[0m");
    expect(out).toContain("font-weight:bold");
    expect(out).toContain("bold");
  });

  it("resets attributes on \\x1b[0m", () => {
    const out = ansiToHtml("\x1b[31mred\x1b[0mplain");
    expect(out).toContain("plain");
    expect(out.endsWith("plain")).toBe(true);
  });

  it("supports underline and italic", () => {
    const out = ansiToHtml("\x1b[3;4mformatted\x1b[0m");
    expect(out).toContain("font-style:italic");
    expect(out).toContain("text-decoration:underline");
  });

  it("handles 256-color foreground (\\x1b[38;5;N m)", () => {
    const out = ansiToHtml("\x1b[38;5;202morange\x1b[0m");
    expect(out).toContain("color:");
  });

  it("handles truecolor foreground (\\x1b[38;2;R;G;B m)", () => {
    const out = ansiToHtml("\x1b[38;2;255;128;0mrgb\x1b[0m");
    expect(out).toContain("color:#ff8000");
  });

  it("escapes HTML inside styled spans", () => {
    const out = ansiToHtml("\x1b[31m<b>x</b>\x1b[0m");
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("returns empty string for empty input", () => {
    expect(ansiToHtml("")).toBe("");
  });
});
