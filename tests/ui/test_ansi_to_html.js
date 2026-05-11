// @ts-check
import { describe, it, expect } from "vitest";
import { ansiToHtml } from "../../ui/utils/ansi-to-html.js";

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

  it("supports dim, strikethrough", () => {
    const out = ansiToHtml("\x1b[2;9mx\x1b[0m");
    expect(out).toContain("opacity:0.5");
    expect(out).toContain("text-decoration:line-through");
  });

  it("disables bold and dim on code 22", () => {
    const out = ansiToHtml("\x1b[1mb\x1b[22mc\x1b[0m");
    expect(out).toContain("font-weight:bold");
    expect(out.endsWith("c")).toBe(true);
  });

  it("disables italic on code 23", () => {
    const out = ansiToHtml("\x1b[3mi\x1b[23mc\x1b[0m");
    expect(out).toContain("font-style:italic");
  });

  it("disables underline on code 24", () => {
    const out = ansiToHtml("\x1b[4mu\x1b[24mc\x1b[0m");
    expect(out).toContain("text-decoration:underline");
  });

  it("disables strikethrough on code 29", () => {
    const out = ansiToHtml("\x1b[9ms\x1b[29mc\x1b[0m");
    expect(out).toContain("line-through");
  });

  it("resets foreground on code 39 and background on code 49", () => {
    const out = ansiToHtml("\x1b[31;42mx\x1b[39;49my\x1b[0m");
    expect(out).toContain("color:");
    expect(out).toContain("background:");
    expect(out).toContain("y");
  });

  it("renders bright foreground colors (codes 90-97)", () => {
    const out = ansiToHtml("\x1b[91mbright\x1b[0m");
    expect(out).toContain("color:");
  });

  it("renders background colors (codes 40-47)", () => {
    const out = ansiToHtml("\x1b[41mbg\x1b[0m");
    expect(out).toContain("background:");
  });

  it("renders bright background colors (codes 100-107)", () => {
    const out = ansiToHtml("\x1b[101mbg\x1b[0m");
    expect(out).toContain("background:");
  });

  it("handles 256-color background (\\x1b[48;5;N m)", () => {
    const out = ansiToHtml("\x1b[48;5;208morange-bg\x1b[0m");
    expect(out).toContain("background:");
  });

  it("handles truecolor background (\\x1b[48;2;R;G;B m)", () => {
    const out = ansiToHtml("\x1b[48;2;0;128;255mrgb-bg\x1b[0m");
    expect(out).toContain("background:#0080ff");
  });

  it("treats bare ESC[m as reset", () => {
    const out = ansiToHtml("\x1b[31ma\x1b[mb");
    expect(out).toContain("b");
    expect(out.endsWith("b")).toBe(true);
  });
});
