function $(id) {
  return document.getElementById(id);
}

function safeFit(tab) {
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

function fitTerminalAfterFonts(tab) {
  if (!document.fonts?.ready) return;
  document.fonts.ready.then(() => fitAndSync(tab)).catch(() => {});
}

function ensureTerminalOpened(tab, frame) {
  if (!tab || tab.type !== "terminal" || !tab._pendingOpen || !frame) return false;
  tab._pendingOpen = false;
  tab.term.open(frame);
  fitTerminalAfterFonts(tab);
  connectTerminalWs(tab);
  return true;
}

function setFrameVisible(tab, frame, visible) {
  if (!tab || !frame) return;
  frame.style.display = visible ? (tab.type === "terminal" ? "block" : "") : "none";
}

function refitTerminalWithFocus(tab) {
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

function copyToClipboard(text) {
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

function toDisplayMessage(value, fallback = "") {
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

function showToast(message, type = "error") {
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatCommitMessage(message, githubUrl) {
  if (!message) return "-";
  const escaped = escapeHtml(message);
  if (!githubUrl) return escaped;

  const base = escapeHtml(githubUrl.replace(/\/+$/, ""));
  return escaped.replace(/#(\d+)/g, `<a class="commit-issue-link" href="${base}/issues/$1" target="_blank" rel="noopener">#$1</a>`);
}

function formatCommitTime(timeText) {
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

function buildWorkspaceChangeSummaryHtml(ws) {
  if (!ws || ws.clean !== false) return "";
  const parts = [];
  if (ws.changed_files > 0) parts.push(`<span class="stat-files">${ws.changed_files}F</span>`);
  if (ws.insertions > 0) parts.push(`<span class="stat-add">+${ws.insertions}</span>`);
  if (ws.deletions > 0) parts.push(`<span class="stat-del">-${ws.deletions}</span>`);
  return parts.length > 0 ? parts.join(" ") : "\u25cf";
}

function buildWorkspaceHeaderNumstatHtml(ws) {
  if (!ws || ws.clean !== false) return "";
  const changedFiles = Number.isFinite(ws.changed_files) ? ws.changed_files : 0;
  const insertions = Number.isFinite(ws.insertions) ? ws.insertions : 0;
  const deletions = Number.isFinite(ws.deletions) ? ws.deletions : 0;
  const fileCountHtml = changedFiles > 0 ? `<span class="header-git-files">${changedFiles}F</span>` : "";
  return `<span class="header-git-numstat">${fileCountHtml}<span class="diff-num-plus">+${insertions}</span><span class="diff-num-del">-${deletions}</span></span>`;
}

function showLogin() {
  $("login-screen").style.display = "flex";
  $("app-screen").style.display = "none";
  stopStatusPolling();
}

function showApp() {
  $("login-screen").style.display = "none";
  $("app-screen").style.display = "flex";
  startStatusPolling();
}

function setLoadingStatus(text) {
  $("output").innerHTML = `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function showFormError(errorElementId, message) {
  const el = $(errorElementId);
  el.textContent = toDisplayMessage(message, "入力内容を確認してください");
  el.style.display = "block";
}

function hideFormError(errorElementId) {
  $(errorElementId).style.display = "none";
}

function renderActionButtons(container, actions) {
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

function isImageDataIcon(icon) {
  return icon && (icon.startsWith("data:image/") || icon.startsWith("favicon:") || icon.startsWith("icon:"));
}

function bindLongPress(el, { onLongPress, onClick, delay = 800, moveThreshold = 30, animationTarget } = {}) {
  let timer = null;
  let fired = false;
  let startX = 0;
  let startY = 0;
  let activeTarget = null;
  const resolveTarget = (e) => typeof animationTarget === "function" ? animationTarget(e) : el;
  el.addEventListener("touchstart", (e) => {
    fired = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    const startEvt = e;
    activeTarget = resolveTarget(e);
    if (activeTarget) activeTarget.classList.add("long-pressing");
    timer = setTimeout(() => {
      fired = true;
      if (activeTarget) activeTarget.classList.remove("long-pressing");
      onLongPress(startEvt);
    }, delay);
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
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
    timer = setTimeout(() => {
      fired = true;
      if (activeTarget) activeTarget.classList.remove("long-pressing");
      onLongPress(e);
    }, delay);
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
  if (onClick) {
    el.addEventListener("click", (e) => {
      if (!fired) onClick(e);
    });
  }
}

function setupModalSwipeClose(overlay, closeFn) {
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

const VALID_ICON_COLOR = /^#[0-9a-fA-F]{3,6}$/;

function renderIcon(icon, iconColor, size = 16) {
  if (!icon) return "";
  if (icon.startsWith("data:image/") || icon.startsWith("icon:")) {
    const src = icon.startsWith("icon:") ? `/icons/${icon.slice(5)}` : icon;
    return `<img src="${escapeHtml(src)}" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  if (icon.startsWith("favicon:")) {
    const domain = icon.slice("favicon:".length);
    return `<img src="${faviconUrl(domain)}" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  const styles = [`font-size:${size}px`];
  if (iconColor && VALID_ICON_COLOR.test(iconColor)) {
    styles.push(`color:${iconColor}`);
  }
  return `<span class="mdi ${escapeHtml(icon)}" style="${styles.join(";")}"></span>`;
}
