import { escapeHtml } from "./escape-html.js";
import { XTERM_PALETTE } from "./ansi-to-html.js";

function xtermCellColor(cell, isFg) {
  const isPalette = isFg ? cell.isFgPalette() : cell.isBgPalette();
  const isRGB = isFg ? cell.isFgRGB() : cell.isBgRGB();
  const color = isFg ? cell.getFgColor() : cell.getBgColor();
  if (isPalette) return XTERM_PALETTE[color] || null;
  if (isRGB) return `#${color.toString(16).padStart(6, "0")}`;
  return null;
}

export function terminalBufferToHtml(term) {
  const buf = term.buffer.active;
  const lines = [];
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) { lines.push(""); continue; }
    let html = "";
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell) continue;
      const ch = cell.getChars();
      if (cell.getWidth() === 0 && !ch) continue;
      const fg = xtermCellColor(cell, true);
      const bg = xtermCellColor(cell, false);
      const bold = cell.isBold();
      const dim = cell.isDim();
      const italic = cell.isItalic();
      const underline = cell.isUnderline();
      const strikethrough = cell.isStrikethrough();
      const needsSpan = fg || bg || bold || dim || italic || underline || strikethrough;
      if (needsSpan) {
        let style = "";
        if (fg) style += `color:${fg};`;
        if (bg) style += `background:${bg};`;
        if (bold) style += "font-weight:bold;";
        if (dim) style += "opacity:0.5;";
        if (italic) style += "font-style:italic;";
        if (underline) style += "text-decoration:underline;";
        if (strikethrough) style += "text-decoration:line-through;";
        html += `<span style="${style}">`;
      }
      html += ch ? escapeHtml(ch) : " ";
      if (needsSpan) html += "</span>";
    }
    lines.push(html);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}
