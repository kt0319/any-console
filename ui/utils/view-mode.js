import { escapeHtml } from "./escape-html.js";

const XTERM_PALETTE = (() => {
  const base = [
    "#000000","#cc0000","#4e9a06","#c4a000","#3465a4","#75507b","#06989a","#d3d7cf",
    "#555753","#ef2929","#8ae234","#fce94f","#729fcf","#ad7fa8","#34e2e2","#eeeeec",
  ];
  const cube = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++)
        base.push(`#${cube[r].toString(16).padStart(2,"0")}${cube[g].toString(16).padStart(2,"0")}${cube[b].toString(16).padStart(2,"0")}`);
  for (let i = 0; i < 24; i++) {
    const v = (8 + i * 10).toString(16).padStart(2, "0");
    base.push(`#${v}${v}${v}`);
  }
  return base;
})();

function xtermCellColor(cell, isFg) {
  const isPalette = isFg ? cell.isFgPalette() : cell.isBgPalette();
  const isRGB = isFg ? cell.isFgRGB() : cell.isBgRGB();
  const color = isFg ? cell.getFgColor() : cell.getBgColor();
  if (isPalette) return XTERM_PALETTE[color] || null;
  if (isRGB) return `#${color.toString(16).padStart(6, "0")}`;
  return null;
}

function terminalBufferToHtml(term) {
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

export function ansiToHtml(text) {
  let fg = null;
  let bg = null;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let strikethrough = false;
  let html = "";

  const parts = text.split(/(\x1b\[[0-9;]*m)/);
  for (const part of parts) {
    const m = part.match(/^\x1b\[([\d;]*)m$/);
    if (!m) {
      if (!part) continue;
      const escaped = escapeHtml(part);
      if (fg || bg || bold || dim || italic || underline || strikethrough) {
        let style = "";
        if (fg) style += `color:${fg};`;
        if (bg) style += `background:${bg};`;
        if (bold) style += "font-weight:bold;";
        if (dim) style += "opacity:0.5;";
        if (italic) style += "font-style:italic;";
        if (underline) style += "text-decoration:underline;";
        if (strikethrough) style += "text-decoration:line-through;";
        html += `<span style="${style}">${escaped}</span>`;
      } else {
        html += escaped;
      }
      continue;
    }
    const codes = m[1] ? m[1].split(";").map(Number) : [0];
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { fg = bg = null; bold = dim = italic = underline = strikethrough = false; }
      else if (c === 1) bold = true;
      else if (c === 2) dim = true;
      else if (c === 3) italic = true;
      else if (c === 4) underline = true;
      else if (c === 9) strikethrough = true;
      else if (c === 22) { bold = false; dim = false; }
      else if (c === 23) italic = false;
      else if (c === 24) underline = false;
      else if (c === 29) strikethrough = false;
      else if (c >= 30 && c <= 37) fg = XTERM_PALETTE[c - 30];
      else if (c === 38) {
        if (codes[i + 1] === 5) { fg = XTERM_PALETTE[codes[i + 2]] || null; i += 2; }
        else if (codes[i + 1] === 2) { fg = `#${(codes[i+2]||0).toString(16).padStart(2,"0")}${(codes[i+3]||0).toString(16).padStart(2,"0")}${(codes[i+4]||0).toString(16).padStart(2,"0")}`; i += 4; }
      }
      else if (c === 39) fg = null;
      else if (c >= 40 && c <= 47) bg = XTERM_PALETTE[c - 40];
      else if (c === 48) {
        if (codes[i + 1] === 5) { bg = XTERM_PALETTE[codes[i + 2]] || null; i += 2; }
        else if (codes[i + 1] === 2) { bg = `#${(codes[i+2]||0).toString(16).padStart(2,"0")}${(codes[i+3]||0).toString(16).padStart(2,"0")}${(codes[i+4]||0).toString(16).padStart(2,"0")}`; i += 4; }
      }
      else if (c === 49) bg = null;
      else if (c >= 90 && c <= 97) fg = XTERM_PALETTE[c - 90 + 8];
      else if (c >= 100 && c <= 107) bg = XTERM_PALETTE[c - 100 + 8];
    }
  }
  return html;
}

export async function enterViewMode(tab, frameEl, apiFetch) {
  if (!frameEl || frameEl.classList.contains("view-mode")) return;
  frameEl.classList.add("view-mode");

  const kbWrapper = document.querySelector(".keyboard-input-wrapper");
  if (kbWrapper) kbWrapper.style.display = "none";

  const pre = document.createElement("pre");
  pre.className = "view-mode-textarea";
  const xtermEl = frameEl.querySelector(".xterm-viewport");
  if (xtermEl) {
    const bg = getComputedStyle(xtermEl).backgroundColor;
    if (bg) pre.style.background = bg;
  }
  frameEl.appendChild(pre);

  const match = tab.wsUrl && tab.wsUrl.match(/\/terminal\/ws\/([^/]+)/);
  if (match) {
    const sessionId = match[1];
    try {
      const res = await apiFetch(`/terminal/sessions/${sessionId}/buffer`);
      if (res && res.ok) {
        const data = await res.json();
        pre.innerHTML = ansiToHtml(data.content || "");
        pre.scrollTop = pre.scrollHeight;
        return;
      }
    } catch (_) {}
  }
  if (tab.term) {
    pre.innerHTML = terminalBufferToHtml(tab.term);
    pre.scrollTop = pre.scrollHeight;
  }
}

export function exitViewMode(frameEl) {
  if (!frameEl) return;
  frameEl.classList.remove("view-mode");
  const pre = frameEl.querySelector(".view-mode-textarea");
  if (pre) pre.remove();
}

export function isViewMode(frameEl) {
  return frameEl && frameEl.classList.contains("view-mode");
}
