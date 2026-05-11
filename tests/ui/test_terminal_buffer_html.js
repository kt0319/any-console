// @ts-check
import { describe, it, expect } from "vitest";
import { terminalBufferToHtml } from "../../ui/utils/terminal-buffer-html.js";

function plainCell(ch) {
  return {
    getChars: () => ch,
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
}

function styledCell(ch, overrides = {}) {
  return { ...plainCell(ch), ...overrides };
}

function makeTerm(rows) {
  const lines = rows.map((cells) => {
    if (cells === null) return null;
    return {
      length: cells.length,
      getCell: (x) => cells[x] || null,
    };
  });
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (y) => lines[y] ?? null,
      },
    },
  };
}

describe("terminalBufferToHtml", () => {
  it("renders plain characters", () => {
    const out = terminalBufferToHtml(makeTerm([[plainCell("h"), plainCell("i")]]));
    expect(out).toBe("hi");
  });

  it("escapes HTML in cell content", () => {
    const out = terminalBufferToHtml(makeTerm([[plainCell("<"), plainCell(">")]]));
    expect(out).toBe("&lt;&gt;");
  });

  it("emits a span when the cell is bold", () => {
    const cell = styledCell("b", { isBold: () => true });
    const out = terminalBufferToHtml(makeTerm([[cell]]));
    expect(out).toContain("font-weight:bold");
    expect(out).toContain("b");
  });

  it("uses palette color when isFgPalette is true", () => {
    const cell = styledCell("r", {
      isFgPalette: () => true,
      getFgColor: () => 1,
    });
    const out = terminalBufferToHtml(makeTerm([[cell]]));
    expect(out).toContain("color:#cc0000");
  });

  it("uses RGB color when isFgRGB is true", () => {
    const cell = styledCell("c", {
      isFgRGB: () => true,
      getFgColor: () => 0xff8000,
    });
    const out = terminalBufferToHtml(makeTerm([[cell]]));
    expect(out).toContain("color:#ff8000");
  });

  it("represents missing lines as empty strings", () => {
    const out = terminalBufferToHtml(makeTerm([[plainCell("a")], null, [plainCell("b")]]));
    expect(out.split("\n")).toEqual(["a", "", "b"]);
  });

  it("trims trailing blank lines", () => {
    const out = terminalBufferToHtml(makeTerm([[plainCell("x")], null, null]));
    expect(out).toBe("x");
  });

  it("treats zero-width cells without chars as skippable", () => {
    const wide = styledCell("", { getWidth: () => 0 });
    const out = terminalBufferToHtml(makeTerm([[plainCell("a"), wide, plainCell("b")]]));
    expect(out).toBe("ab");
  });

  it("renders a space when cell has no character", () => {
    const blank = styledCell("", { getWidth: () => 1 });
    const out = terminalBufferToHtml(makeTerm([[plainCell("a"), blank, plainCell("b")]]));
    expect(out).toBe("a b");
  });
});
