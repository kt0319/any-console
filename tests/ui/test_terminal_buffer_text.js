// @ts-check
import { describe, it, expect } from "vitest";
import {
  TERMINAL_URL_REGEX,
  findUrlInBuffer,
  getVisibleBufferText,
} from "../../ui/utils/terminal-buffer-text.js";

function makeTerm({ lines, viewportY = 0, cols = 80, rows = 24, element = null }) {
  const lineObjects = lines.map((text) => ({
    length: text.length,
    getCell: (i) => ({ getChars: () => text[i] || " " }),
    translateToString: () => text,
  }));
  return {
    cols,
    rows,
    element,
    buffer: {
      active: {
        viewportY,
        length: lineObjects.length,
        getLine: (i) => lineObjects[i] || null,
      },
    },
  };
}

describe("TERMINAL_URL_REGEX", () => {
  it("matches https URL", () => {
    const m = "open https://example.com/path here".match(TERMINAL_URL_REGEX);
    expect(m?.[0]).toBe("https://example.com/path");
  });

  it("matches www URL", () => {
    const m = "see www.example.com today".match(TERMINAL_URL_REGEX);
    expect(m?.[0]).toBe("www.example.com");
  });

  it("does not include trailing closing brackets", () => {
    const m = "(https://example.com/x)".match(TERMINAL_URL_REGEX);
    expect(m?.[0]).toBe("https://example.com/x");
  });
});

describe("getVisibleBufferText", () => {
  it("returns null for falsy term", () => {
    expect(getVisibleBufferText(null)).toBeNull();
  });

  it("joins visible lines and trims trailing spaces per line", () => {
    const term = makeTerm({ lines: ["line1   ", "line2", "line3"], viewportY: 0, rows: 3 });
    expect(getVisibleBufferText(term)).toBe("line1\nline2\nline3");
  });

  it("returns null when only blank lines", () => {
    const term = makeTerm({ lines: ["", "", ""], rows: 3 });
    expect(getVisibleBufferText(term)).toBeNull();
  });

  it("respects viewportY offset", () => {
    const term = makeTerm({ lines: ["a", "b", "c", "d"], viewportY: 2, rows: 2 });
    expect(getVisibleBufferText(term)).toBe("c\nd");
  });
});

function makeTermWithRect({ lines, cols = 80, rows = 24, rect = { left: 0, top: 0, width: 800, height: 240 } }) {
  const lineObjects = lines.map((text) => ({
    length: text.length,
    getCell: (i) => ({ getChars: () => text[i] || " " }),
    translateToString: () => text,
  }));
  const element = {
    querySelector: () => ({ getBoundingClientRect: () => rect }),
    getBoundingClientRect: () => rect,
  };
  return {
    cols,
    rows,
    element,
    buffer: {
      active: {
        viewportY: 0,
        length: lineObjects.length,
        getLine: (i) => lineObjects[i] || null,
      },
    },
  };
}

describe("findUrlInBuffer", () => {
  it("returns null when term has no element", () => {
    expect(findUrlInBuffer(null, 0, 0)).toBeNull();
    expect(findUrlInBuffer({ element: null }, 0, 0)).toBeNull();
  });

  it("returns null when click is outside element bounds", () => {
    const term = makeTermWithRect({ lines: ["see https://example.com/"] });
    expect(findUrlInBuffer(term, -10, 0)).toBeNull();
    expect(findUrlInBuffer(term, 0, -10)).toBeNull();
    expect(findUrlInBuffer(term, 10000, 10000)).toBeNull();
  });

  it("returns matched URL when click is on it", () => {
    const line = "see https://example.com/path here";
    const term = makeTermWithRect({ lines: [line], cols: line.length, rows: 1, rect: { left: 0, top: 0, width: line.length * 10, height: 20 } });
    const url = findUrlInBuffer(term, 4 * 10 + 5, 10);
    expect(url).toBe("https://example.com/path");
  });

  it("prepends https for www URLs", () => {
    const line = "go www.example.com/";
    const term = makeTermWithRect({ lines: [line], cols: line.length, rows: 1, rect: { left: 0, top: 0, width: line.length * 10, height: 20 } });
    const url = findUrlInBuffer(term, 3 * 10 + 5, 10);
    expect(url).toBe("https://www.example.com/");
  });

  it("returns null when click is on non-URL text", () => {
    const line = "no url here";
    const term = makeTermWithRect({ lines: [line], cols: line.length, rows: 1, rect: { left: 0, top: 0, width: line.length * 10, height: 20 } });
    expect(findUrlInBuffer(term, 0, 10)).toBeNull();
  });
});
