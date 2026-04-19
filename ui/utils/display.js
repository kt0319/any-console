export { formatGitTime as formatCommitTime } from "./git.js";

export function toDisplayMessage(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return toDisplayMessage(value.message, fallback);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (item && typeof item === "object" && typeof item.msg === "string") {
          return item.msg;
        }
        return toDisplayMessage(item, "");
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(" / ") : fallback;
  }
  if (typeof value === "object") {
    if ("detail" in value) return toDisplayMessage(value.detail, fallback);
    if ("message" in value) return toDisplayMessage(value.message, fallback);
    if ("msg" in value) return toDisplayMessage(value.msg, fallback);
    if ("error" in value) return toDisplayMessage(value.error, fallback);
    if ("stderr" in value) return toDisplayMessage(value.stderr, fallback);
    if ("stdout" in value) return toDisplayMessage(value.stdout, fallback);
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function buildWorkspaceChangeSummaryHtml(ws) {
  if (!ws || ws.clean !== false) return "";
  const parts = [];
  if (ws.changed_files > 0) parts.push(`<span class="stat-files">${ws.changed_files}F</span>`);
  if (ws.insertions > 0) parts.push(`<span class="stat-add">+${ws.insertions}</span>`);
  if (ws.deletions > 0) parts.push(`<span class="stat-del">-${ws.deletions}</span>`);
  return parts.length > 0 ? parts.join(" ") : "\u25cf";
}

export const VALID_ICON_COLOR = /^#[0-9a-fA-F]{3,6}$/;

export function isImageDataIcon(icon) {
  return typeof icon === "string" && icon.startsWith("data:image/");
}

export function faviconUrl(domain) {
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
}
