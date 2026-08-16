import { escapeHtml } from "./escape-html.ts";

const DIFF_COLORS: Record<string, string> = {
  "+": "var(--diff-add, #9ece6a)",
  "-": "var(--diff-del, #f7768e)",
  "@": "var(--diff-hunk, #7aa2f7)",
};

export function escapeDiffHtml(str: string | null | undefined): string {
  if (!str) return "";
  return escapeHtml(str);
}

export function colorDiff(text: string | null | undefined): string {
  if (!text) return "";
  return text.split("\n").map((line) => {
    const prefix = line[0];
    const color = DIFF_COLORS[prefix];
    if (color) return `<span style="color:${color}">${escapeDiffHtml(line)}</span>`;
    return escapeDiffHtml(line);
  }).join("\n");
}
