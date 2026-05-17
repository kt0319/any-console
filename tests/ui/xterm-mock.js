// @ts-check
/** Shared xterm cell/terminal mock builders for tests */

export function plainCell(ch) {
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

export function styledCell(ch, overrides = {}) {
  return { ...plainCell(ch), ...overrides };
}

export function makeTerm(rows) {
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
