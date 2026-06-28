let tooltipEl = null;
let hideTimer = null;

function getEl() {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "ac-tooltip";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function show(target, text) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  const el = getEl();
  el.textContent = text;
  el.style.display = "block";
  el.style.opacity = "0";

  const rect = target.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.left + rect.width / 2 - elRect.width / 2;
  let top = rect.bottom + 6;

  if (left < 8) left = 8;
  if (left + elRect.width > vw - 8) left = vw - elRect.width - 8;
  if (top + elRect.height > vh - 8) top = rect.top - elRect.height - 6;

  el.style.left = left + "px";
  el.style.top = top + "px";
  el.style.opacity = "1";
}

function hide() {
  if (!tooltipEl) return;
  tooltipEl.style.opacity = "0";
  hideTimer = setTimeout(() => {
    if (tooltipEl) tooltipEl.style.display = "none";
  }, 100);
}

export function installTooltip() {
  const style = document.createElement("style");
  style.textContent = `
    .ac-tooltip {
      display: none;
      position: fixed;
      padding: 5px 10px;
      font-size: 12px;
      line-height: 1.2;
      color: var(--text-primary, #e0e4fc);
      background: var(--bg-tertiary, #2f3347);
      border: 1px solid var(--border, #3b4261);
      border-radius: var(--radius, 6px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      white-space: nowrap;
      pointer-events: none;
      z-index: 99999;
      transition: opacity 0.1s;
    }
  `;
  document.head.appendChild(style);

  document.addEventListener("mouseover", (e) => {
    const el = e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
    if (el instanceof HTMLElement) show(el, el.dataset.tooltip);
  });

  document.addEventListener("mouseout", (e) => {
    if (e.target instanceof Element && e.target.closest("[data-tooltip]")) hide();
  });

  document.addEventListener("click", hide);
  document.addEventListener("scroll", hide, true);
}
