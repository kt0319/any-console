// URL 本体は非ASCII文字（全角カッコ「（）」や日本語など）でも終端する。
// URL に生の非ASCIIは入らない前提。これがないと `http://host:3900（Tailscale直）` の
// ように後続の全角テキストまで URL に飲み込まれる（日本語はスペースが無いため）。
export const TERMINAL_URL_REGEX = /(https?:\/\/[^\s)\]>'"\u0080-\uffff]+|www\.[^\s)\]>'"\u0080-\uffff]+)/g;

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

  // isWrapped（ターミナル折り返し）と行末文字（アプリ改行）の両方で連結行を判定する。
  function lineEndsWithUrlChar(idx) {
    const l = buf.getLine(idx);
    if (!l) return false;
    const last = l.translateToString(true).slice(-1);
    return !!last && last !== " ";
  }

  let startIdx = lineIdx;
  while (startIdx > 0) {
    if (buf.getLine(startIdx)?.isWrapped || lineEndsWithUrlChar(startIdx - 1)) {
      startIdx--;
    } else {
      break;
    }
  }

  let endIdx = lineIdx;
  while (endIdx < buf.length - 1) {
    const next = buf.getLine(endIdx + 1);
    if (next?.isWrapped || lineEndsWithUrlChar(endIdx)) {
      endIdx++;
    } else {
      break;
    }
  }

  let text = "";
  const lineOffsets = {};
  for (let i = startIdx; i <= endIdx; i++) {
    const cur = buf.getLine(i);
    if (!cur) break;
    lineOffsets[i] = text.length;
    // 折り返し行の末尾スペースパディングを除いてから結合する。
    // xterm は折り返し行の余白をスペースで埋めるため、そのまま結合すると
    // 正規表現がスペースで URL を途切れさせる。
    const lineText = cur.translateToString(true);
    // 最終行以外は末尾スペースをトリムして継続結合する。
    text += (i < endIdx) ? lineText.trimEnd() : lineText;
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

export function getFullBufferText(term) {
  if (!term) return null;
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    lines.push(line.translateToString(true).replace(/[\s 　]+$/, ""));
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") || null;
}
