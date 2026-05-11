import { terminalSessionBufferPath } from "./endpoints.js";
import { ansiToHtml } from "./ansi-to-html.js";
import { terminalBufferToHtml } from "./terminal-buffer-html.js";

export { ansiToHtml };

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
