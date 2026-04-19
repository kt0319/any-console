import { escapeHtml } from "./escape-html.js";

export function splitDiffByFile(diffText) {
  if (!diffText) return {};
  const chunks = {};
  let currentFile = null;
  let currentLines = [];
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (currentFile) chunks[currentFile] = currentLines.join("\n");
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      currentFile = match ? match[1] : line;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentFile) chunks[currentFile] = currentLines.join("\n");
  return chunks;
}

export function getDiffStatusTone(status) {
  const s = (status || "").toUpperCase();
  if (s === "??" || s === "A") return "add";
  if (s.includes("D")) return "del";
  if (s.includes("R")) return "ren";
  if (s.includes("M")) return "mod";
  return "neutral";
}

export function renderNumstatHtml(insertions, deletions, extraClass = "") {
  const hasIns = Number.isFinite(insertions);
  const hasDel = Number.isFinite(deletions);
  if (!hasIns && !hasDel) return "";
  const ins = hasIns ? insertions : 0;
  const del = hasDel ? deletions : 0;
  const cls = extraClass ? `diff-file-row-numstat ${extraClass}` : "diff-file-row-numstat";
  return `<span class="${cls}"><span class="diff-num-plus">+${ins}</span><span class="diff-num-del">-${del}</span></span>`;
}

export function renderNumstatNoteHtml(text) {
  return `<span class="diff-file-row-numstat-note">${escapeHtml(text)}</span>`;
}

export { escapeHtml };
