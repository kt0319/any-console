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

  it("returns null when click is far outside element bounds", () => {
    const term = makeTermWithRect({ lines: ["see https://example.com/"] });
    expect(findUrlInBuffer(term, -10, 0)).toBeNull();
    expect(findUrlInBuffer(term, 0, -10)).toBeNull();
    expect(findUrlInBuffer(term, 10000, 10000)).toBeNull();
  });

  it("矩形からわずかにはみ出た座標でもクランプして検出する（長押し確定時のレイアウトずれ対策）", () => {
    const line = "see https://example.com/path here";
    const term = makeTermWithRect({ lines: [line], cols: line.length, rows: 1, rect: { left: 0, top: 0, width: line.length * 10, height: 20 } });
    // URL の直上（x = 4*10+5）だが Y がわずかに矩形の下端をはみ出している。
    const url = findUrlInBuffer(term, 4 * 10 + 5, 25);
    expect(url).toBe("https://example.com/path");
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

  it("継続行の先頭インデント（シェルの折返し表示）を挟んでも正しく復元する", () => {
    // 実機（tmux配下のシェル）で確認した実際のパターン: 折返し継続行は行頭に
    // 字下げ用の空白が入り、直前行の末尾もそれに揃えてスペースで埋められる。
    // 末尾だけトリムして直結すると行頭の空白が本物の空白として残り、そこで
    // URL が打ち切られていた（実際に長押し検出が1行目だけで途切れる不具合の
    // 根本原因）。
    const part1 = "https://cloud.ouraring.com/oauth/authorize?response_ty";
    const part2 = "  pe=code&client_id=8b6afc82-0e1e-43f9-9cd7-c04ab14ff164";
    const cols = Math.max(part1.length, part2.length);
    const lineObjects = [
      { length: cols, isWrapped: false,
        getCell: (i) => ({ getChars: () => part1[i] || " " }),
        translateToString: () => part1 + "  " },
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
    const url = findUrlInBuffer(term, 10, 5);
    expect(url).toBe("https://cloud.ouraring.com/oauth/authorize?response_type=code&client_id=8b6afc82-0e1e-43f9-9cd7-c04ab14ff164");
  });

  it("1行目末尾だけ本物の空白文字がある折返しURLでも正しく復元する", () => {
    // 実際に報告されたケース: TUI の再描画で1行目だけ行末までスペースで
    // クリアされ、本物のスペース文字が残ることがある（後続行には無い）。
    // WebLinksAddon 自身の判定はこのスペースで打ち切られる
    // （node_modules/@xterm/addon-web-links の lines.join('') は未トリム）ため、
    // findUrlInBuffer 側で正しく trimEnd 復元できることを固定化する。
    const part1 = "https://cloud.ouraring.com/oauth/authorize?response_ty ";
    const part2 = "pe=code&client_id=8b6afc82-0e1e-43f9-9cd7-c04ab14ff164";
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
    const url = findUrlInBuffer(term, 10, 5);
    expect(url).toBe("https://cloud.ouraring.com/oauth/authorize?response_type=code&client_id=8b6afc82-0e1e-43f9-9cd7-c04ab14ff164");
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
