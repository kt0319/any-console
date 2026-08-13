// @ts-check
import { describe, it, expect } from "vitest";
import {
  TERMINAL_URL_REGEX,
  findUrlInBuffer,
} from "../../ui/utils/terminal-buffer-text.ts";

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

  it("stops at full-width parenthesis and CJK text", () => {
    // 日本語はスペースが無く、全角カッコは ASCII の ) ではないため、
    // 非ASCII終端が無いと後続テキストまで URL に飲み込まれる。
    const m = "は http://100.109.44.17:3900（Tailscale直）で稼働中".match(TERMINAL_URL_REGEX);
    expect(m?.[0]).toBe("http://100.109.44.17:3900");
  });
});

function makeTermWithRect({ lines, cols = 80, rows = 24, rect = { left: 0, top: 0, width: 800, height: 240 } }) {
  const lineObjects = lines.map((text) => ({
    length: text.length,
    isWrapped: false,
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

  it("isWrapped な折り返し行をまたいで URL を検出する", () => {
    // "https://github.com/kt0319/actions/r" が行末で折り返し "unners/new" が次行に続く
    const part1 = "https://github.com/kt0319/actions/r";
    const part2 = "unners/new";
    const cols = part1.length;
    const lineObjects = [
      { length: cols, isWrapped: false,
        getCell: (i) => ({ getChars: () => part1[i] || " " }),
        translateToString: () => part1 },
      { length: cols, isWrapped: true,
        getCell: (i) => ({ getChars: () => part2[i] || " " }),
        translateToString: () => part2.padEnd(cols) },
    ];
    const rect = { left: 0, top: 0, width: cols * 10, height: 40 };
    const element = { querySelector: () => ({ getBoundingClientRect: () => rect }) };
    const term = {
      cols, rows: 2, element,
      buffer: { active: { viewportY: 0, length: 2, getLine: (i) => lineObjects[i] || null } },
    };
    // 2行目の "u" をクリック → URL全体が返る
    const url = findUrlInBuffer(term, 0, 25);
    expect(url).toBe("https://github.com/kt0319/actions/runners/new");
  });

  it("isWrapped=false（アプリ側の明示的な改行）でも前後の行を束ねてURLを検出する", () => {
    // ポート番号の直後で改行され、次行にパスが続くケース（実際に報告された
    // 「ポート番号までしか認識しない」不具合の再現）。
    const part1 = "https://mini.tail794a9.ts.net:23001";
    const part2 = "/business-partner-management";
    const cols = Math.max(part1.length, part2.length);
    const lineObjects = [
      { length: cols, isWrapped: false,
        getCell: (i) => ({ getChars: () => part1[i] || " " }),
        translateToString: () => part1 },
      { length: cols, isWrapped: false,
        getCell: (i) => ({ getChars: () => part2[i] || " " }),
        translateToString: () => part2 },
    ];
    const rect = { left: 0, top: 0, width: cols * 10, height: 40 };
    const element = { querySelector: () => ({ getBoundingClientRect: () => rect }) };
    const term = {
      cols, rows: 2, element,
      buffer: { active: { viewportY: 0, length: 2, getLine: (i) => lineObjects[i] || null } },
    };
    // 1行目末尾（ポート番号付近）をクリック → 2行目のパスまで含めた全体が返る
    const url = findUrlInBuffer(term, (part1.length - 1) * 10, 5);
    expect(url).toBe("https://mini.tail794a9.ts.net:23001/business-partner-management");
  });
});
