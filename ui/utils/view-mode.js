import { escapeHtml } from "./escape-html.js";
import { terminalSessionBufferPath } from "./endpoints.js";
import { XTERM_PALETTE, ansiToHtml } from "./ansi-to-html.js";

export { ansiToHtml };

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

export async function enterViewMode(tab, frameEl, apiFetch) {
  if (!frameEl || frameEl.classList.contains("view-mode")) return;
  frameEl.classList.add("view-mode");

  const kbWrapper = /** @type {HTMLElement | null} */ (document.querySelector(".keyboard-input-wrapper"));
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
      const res = await apiFetch(terminalSessionBufferPath(sessionId));
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
