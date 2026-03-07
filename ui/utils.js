// @ts-check
import { openTabs, activeTabId, splitMode, panelBottom, selectedWorkspace, isTouchDevice } from './state-core.js';

/**
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export function $(id) {
  return document.getElementById(id);
}

/**
 * @param {object} tab
 * @returns {void}
 */
export function safeFit(tab) {
  if (!tab || !tab.fitAddon) return;
  const frame = tab.id ? $(`frame-${tab.id}`) : null;
  if (!frame || frame.style.display === "none") return;
  const rect = frame.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  try {
    tab.fitAddon.fit();
  } catch (e) {
    console.warn("fitAddon.fit failed:", e);
  }
}

/**
 * @param {object} tab
 * @returns {void}
 */
export function fitAndSync(tab) {
  safeFit(tab);
  const cols = tab.term.cols;
  const rows = tab.term.rows;
  if (cols < 2 || rows < 2) return;
  if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
    const resizePayload = new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify({ cols, rows }))]);
    tab.ws.send(resizePayload);
  }
}

export function fitTerminalAfterFonts(tab) {
  if (!document.fonts?.ready) return;
  document.fonts.ready.then(() => fitAndSync(tab)).catch(() => {});
}


/**
 * @param {object} tab
 * @param {HTMLElement} frame
 * @param {boolean} visible
 * @returns {void}
 */
export function setFrameVisible(tab, frame, visible) {
  if (!tab || !frame) return;
  frame.style.display = visible ? (tab.type === "terminal" ? "block" : "") : "none";
}

/**
 * @param {object} tab
 * @returns {void}
 */
export function refitTerminalWithFocus(tab) {
  if (!tab || tab.type !== "terminal") return;
  const doFit = () => {
    fitAndSync(tab);
    tab.term.focus();
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(doFit);
  });
  setTimeout(doFit, 300);
}

/**
 * @param {string} text
 * @returns {void}
 */
export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch((e) => console.error("clipboard write failed:", e));
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

/**
 * @param {*} value
 * @param {string} [fallback]
 * @returns {string}
 */
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

/**
 * @param {*} message
 * @param {string} [type]
 * @returns {void}
 */
export function showToast(message, type = "error") {
  const text = toDisplayMessage(message, "不明なエラー");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = text;
  el.style.cursor = "pointer";
  let dismissed = false;
  const restack = () => {
    const toasts = document.querySelectorAll(".toast.show");
    let offset = 24;
    toasts.forEach((t) => {
      t.style.top = offset + "px";
      offset += t.offsetHeight + 8;
    });
  };
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove("show");
    el.addEventListener("transitionend", () => {
      el.remove();
      restack();
    });
  };
  el.addEventListener("click", () => {
    copyToClipboard(text);
    dismiss();
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add("show");
    restack();
  });
  setTimeout(dismiss, 3000);
}

/**
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * @param {string} message
 * @param {string} [githubUrl]
 * @returns {string}
 */
export function formatCommitMessage(message, githubUrl) {
  if (!message) return "-";
  const escaped = escapeHtml(message);
  if (!githubUrl) return escaped;

  const base = escapeHtml(githubUrl.replace(/\/+$/, ""));
  return escaped.replace(/#(\d+)/g, `<a class="commit-issue-link" href="${base}/issues/$1" target="_blank" rel="noopener">#$1</a>`);
}

/**
 * @param {string} timeText
 * @returns {string}
 */
export function formatCommitTime(timeText) {
  if (!timeText) return "-";
  const d = new Date(timeText);
  if (Number.isNaN(d.getTime())) return escapeHtml(timeText);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

/**
 * @param {object} ws
 * @returns {string}
 */
export function buildWorkspaceChangeSummaryHtml(ws) {
  if (!ws || ws.clean !== false) return "";
  const parts = [];
  if (ws.changed_files > 0) parts.push(`<span class="stat-files">${ws.changed_files}F</span>`);
  if (ws.insertions > 0) parts.push(`<span class="stat-add">+${ws.insertions}</span>`);
  if (ws.deletions > 0) parts.push(`<span class="stat-del">-${ws.deletions}</span>`);
  return parts.length > 0 ? parts.join(" ") : "\u25cf";
}

/**
 * @param {object} ws
 * @returns {string}
 */
export function buildWorkspaceHeaderNumstatHtml(ws) {
  if (!ws || ws.clean !== false) return "";
  const changedFiles = Number.isFinite(ws.changed_files) ? ws.changed_files : 0;
  const insertions = Number.isFinite(ws.insertions) ? ws.insertions : 0;
  const deletions = Number.isFinite(ws.deletions) ? ws.deletions : 0;
  const fileCountHtml = changedFiles > 0 ? `<span class="header-git-files">${changedFiles}F</span>` : "";
  return `<span class="header-git-numstat">${fileCountHtml}<span class="diff-num-plus">+${insertions}</span><span class="diff-num-del">-${deletions}</span></span>`;
}

/**
 * @returns {void}
 */
export function showLogin() {
  $("login-screen").style.display = "flex";
  $("app-screen").style.display = "none";

}

/**
 * @returns {void}
 */
export function showApp() {
  $("login-screen").style.display = "none";
  $("app-screen").style.display = "flex";
}

/**
 * @param {string} text
 * @returns {void}
 */
export function setLoadingStatus(text) {
  $("output").innerHTML = `<div class="empty-state">${escapeHtml(text)}</div>`;
}

/**
 * @param {string} errorElementId
 * @param {*} message
 * @returns {void}
 */
export function showFormError(errorElementId, message) {
  const el = $(errorElementId);
  el.textContent = toDisplayMessage(message, "入力内容を確認してください");
  el.style.display = "block";
}

/**
 * @param {string} errorElementId
 * @returns {void}
 */
export function hideFormError(errorElementId) {
  $(errorElementId).style.display = "none";
}

/**
 * @param {HTMLElement} container
 * @param {Array<{label: string, fn: function, cls?: string, key?: string}>} actions
 * @returns {void}
 */
export function renderActionButtons(container, actions) {
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "commit-action-item" + (action.cls ? ` ${action.cls}` : "");
    if (action.key) btn.dataset.actionKey = action.key;
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action.fn();
    });
    container.appendChild(btn);
  }
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * @param {string} domain
 * @returns {string}
 */
export function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

/**
 * @param {string} icon
 * @returns {boolean}
 */
export function isImageDataIcon(icon) {
  return icon && (icon.startsWith("data:image/") || icon.startsWith("favicon:") || icon.startsWith("icon:"));
}

/**
 * @param {HTMLElement} el
 * @param {{onLongPress: function, onClick?: function, delay?: number, moveThreshold?: number, animationTarget?: function, contextMenu?: boolean}} [options]
 * @returns {void}
 */
export function bindLongPress(el, { onLongPress, onClick, delay = 800, moveThreshold = 30, animationTarget, contextMenu = true } = {}) {
  let timer = null;
  let fired = false;
  let touchActive = false;
  let startX = 0;
  let startY = 0;
  let activeTarget = null;
  const resolveTarget = (e) => typeof animationTarget === "function" ? animationTarget(e) : el;
  const fireLongPress = (e) => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    if (activeTarget) activeTarget.classList.remove("long-pressing");
    onLongPress(e);
  };
  el.addEventListener("touchstart", (e) => {
    touchActive = true;
    fired = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    const startEvt = e;
    activeTarget = resolveTarget(e);
    if (activeTarget) activeTarget.classList.add("long-pressing");
    timer = setTimeout(() => fireLongPress(startEvt), delay);
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    touchActive = false;
    clearTimeout(timer);
    if (activeTarget) activeTarget.classList.remove("long-pressing");
    activeTarget = null;
    if (fired) {
      e.preventDefault();
    }
  });
  el.addEventListener("touchmove", (e) => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (dx * dx + dy * dy > moveThreshold * moveThreshold) {
      clearTimeout(timer);
      if (activeTarget) activeTarget.classList.remove("long-pressing");
      activeTarget = null;
    }
  }, { passive: true });
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    activeTarget = resolveTarget(e);
    if (activeTarget) activeTarget.classList.add("long-pressing");
    timer = setTimeout(() => fireLongPress(e), delay);
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") return;
    clearTimeout(timer);
    if (activeTarget) activeTarget.classList.remove("long-pressing");
    activeTarget = null;
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > moveThreshold * moveThreshold) {
      clearTimeout(timer);
      if (activeTarget) activeTarget.classList.remove("long-pressing");
      activeTarget = null;
    }
  });
  if (contextMenu) {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!touchActive) fireLongPress(e);
    });
  }
  if (onClick) {
    el.addEventListener("click", (e) => {
      if (!fired) onClick(e);
    });
  }
}

/**
 * @param {HTMLElement} overlay
 * @param {function} closeFn
 * @returns {void}
 */
export function setupModalSwipeClose(overlay, closeFn) {
  const modal = overlay.querySelector(".modal");
  if (!modal) return;

  const handle = document.createElement("div");
  handle.className = "modal-swipe-handle";
  handle.innerHTML = '<span class="modal-swipe-bar"></span>';
  modal.appendChild(handle);

  const THRESHOLD = 80;
  let startY = 0;
  let currentY = 0;
  let dragging = false;

  function onTouchStart(e) {
    startY = e.touches[0].clientY;
    currentY = startY;
    dragging = true;
    modal.style.transition = "none";
  }

  function onTouchMove(e) {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
    const dy = startY - currentY;
    if (dy > 0) {
      modal.style.transform = `translateY(-${dy}px)`;
      modal.style.opacity = Math.max(0.2, 1 - dy / 400);
    }
  }

  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;
    const dy = startY - currentY;
    if (dy > THRESHOLD) {
      modal.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
      modal.style.transform = "translateY(-100%)";
      modal.style.opacity = "0";
      modal.addEventListener("transitionend", () => {
        modal.style.transform = "";
        modal.style.opacity = "";
        modal.style.transition = "";
        closeFn();
      }, { once: true });
    } else {
      modal.style.transition = "transform 0.2s ease-out, opacity 0.2s ease-out";
      modal.style.transform = "";
      modal.style.opacity = "";
      modal.addEventListener("transitionend", () => {
        modal.style.transition = "";
      }, { once: true });
    }
  }

  handle.addEventListener("touchstart", onTouchStart, { passive: true });
  handle.addEventListener("touchmove", onTouchMove, { passive: true });
  handle.addEventListener("touchend", onTouchEnd);
}

/**
 * @param {HTMLElement} modal
 * @param {function} closeFn
 * @returns {function}
 */
export function trapFocus(modal, closeFn) {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeFn();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null
    );
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  modal.addEventListener("keydown", onKeydown);
  const focusable = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null
  );
  if (focusable.length > 0) focusable[0].focus();

  return () => modal.removeEventListener("keydown", onKeydown);
}

export const VALID_ICON_COLOR = /^#[0-9a-fA-F]{3,6}$/;

/**
 * @param {string} icon
 * @param {string} iconColor
 * @param {number} [size]
 * @returns {string}
 */
export function renderIcon(icon, iconColor, size = 16) {
  if (!icon) return "";
  if (icon.startsWith("data:image/") || icon.startsWith("icon:")) {
    const src = icon.startsWith("icon:") ? `/icons/${icon.slice(5)}` : icon;
    return `<img src="${escapeHtml(src)}" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  if (icon.startsWith("favicon:")) {
    const domain = icon.slice("favicon:".length);
    return `<img src="${faviconUrl(domain)}" width="${size}" height="${size}" class="favicon-icon" alt="" onerror="this.style.display='none'" />`;
  }
  const styles = [`font-size:${size}px`];
  if (iconColor && VALID_ICON_COLOR.test(iconColor)) {
    styles.push(`color:${iconColor}`);
  }
  return `<span class="mdi ${escapeHtml(icon)}" style="${styles.join(";")}"></span>`;
}
