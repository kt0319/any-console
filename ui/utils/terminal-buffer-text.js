export const TERMINAL_URL_REGEX = /(https?:\/\/[^\s)\]>'"]+|www\.[^\s)\]>'"]+)/g;

function lastCharOfLine(line) {
  if (!line) return " ";
  return line.getCell(line.length - 1)?.getChars() || " ";
}

export function findUrlInBuffer(term, clientX, clientY) {
  if (!term || !term.element) return null;
  const screen = term.element.querySelector(".xterm-screen") || term.element;
  const rect = screen.getBoundingClientRect();
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;
  if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) return null;
  const cols = term.cols;
  const rows = term.rows;
  if (!cols || !rows) return null;
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  const col = Math.floor(relX / cellW);
  const rowOffset = Math.floor(relY / cellH);
  const buf = term.buffer.active;
  const lineIdx = buf.viewportY + rowOffset;
  if (!buf.getLine(lineIdx)) return null;

  let startIdx = lineIdx;
  while (startIdx > 0) {
    const prev = buf.getLine(startIdx - 1);
    if (!prev) break;
    const last = lastCharOfLine(prev);
    if (last === "" || last === " ") break;
    startIdx--;
  }

  let endIdx = lineIdx;
  while (endIdx < buf.length - 1) {
    const cur = buf.getLine(endIdx);
    if (!cur) break;
    const last = lastCharOfLine(cur);
    if (last === "" || last === " ") break;
    endIdx++;
  }

  let text = "";
  const lineOffsets = {};
  for (let i = startIdx; i <= endIdx; i++) {
    const cur = buf.getLine(i);
    if (!cur) break;
    lineOffsets[i] = text.length;
    for (let j = 0; j < cur.length; j++) {
      text += cur.getCell(j)?.getChars() || "";
    }
  }

  const absPos = (lineOffsets[lineIdx] || 0) + col;
  TERMINAL_URL_REGEX.lastIndex = 0;
  let m;
  while ((m = TERMINAL_URL_REGEX.exec(text)) !== null) {
    if (absPos >= m.index && absPos < m.index + m[0].length) {
      let url = m[0];
      if (url.startsWith("www.")) url = "https://" + url;
      return url;
    }
  }
  return null;
}

export function getVisibleBufferText(term) {
  if (!term) return null;
  const buf = term.buffer.active;
  const start = buf.viewportY;
  const end = Math.min(buf.length - 1, buf.viewportY + term.rows - 1);
  const lines = [];
  for (let i = start; i <= end; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    lines.push(line.translateToString(true).replace(/[\s 　]+$/, ""));
  }
  return lines.join("\n").replace(/^\n+|\n+$/g, "") || null;
}
