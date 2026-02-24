function $(id) {
  return document.getElementById(id);
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => copyToClipboardFallback(text));
  } else {
    copyToClipboardFallback(text);
  }
}

function copyToClipboardFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function showToast(message, type = "error") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  el.style.cursor = "pointer";
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove("show");
    el.addEventListener("transitionend", () => el.remove());
  };
  el.addEventListener("click", () => {
    copyToClipboard(message);
    dismiss();
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(dismiss, 3000);
}

function formatTimeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 0) return "";
  const sec = Math.floor(diff / 1000);
  if (sec < 300) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
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

function showLogin() {
  $("login-screen").style.display = "flex";
  $("app-screen").style.display = "none";
  stopAutoRefresh();
}

function showApp() {
  $("login-screen").style.display = "none";
  $("app-screen").style.display = "flex";
  startAutoRefresh();
}

function setLoadingStatus(text) {
  $("output").innerHTML = `<div class="empty-state">${escapeHtml(text)}</div>`;
}

async function apiFetch(endpoint, { method = "GET", body = null } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== null && typeof body === "object") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const t0 = Date.now();
  const res = await fetch(endpoint, { method, headers, body });
  if (endpoint !== "/logs/client" && typeof addLog === "function") {
    addLog("api", method, { path: endpoint, status: res.status, ms: Date.now() - t0 });
  }
  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }
  return res;
}

function workspaceApiPath(workspace, path = "") {
  return `/workspaces/${encodeURIComponent(workspace)}${path}`;
}

function showFormError(errorElementId, message) {
  const el = $(errorElementId);
  el.textContent = message;
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
  return icon && (icon.startsWith("data:image/") || icon.startsWith("favicon:"));
}

async function loadWsIconButtons(container, ws, iconSize, onLinkClick, onJobClick) {
  let jobs = {};
  let links = [];
  try {
    const [jobsRes, linksRes] = await Promise.all([
      apiFetch(workspaceApiPath(ws.name, "/jobs")),
      apiFetch(workspaceApiPath(ws.name, "/links")),
    ]);
    if (jobsRes && jobsRes.ok) jobs = await jobsRes.json();
    if (linksRes && linksRes.ok) links = await linksRes.json();
  } catch {}

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-ws-icon-btn picker-ws-link-btn";
    btn.title = link.label || link.url;
    btn.innerHTML = renderIcon(link.icon || "mdi-web", link.icon_color, iconSize);
    btn.addEventListener("click", () => onLinkClick(link, i));
    container.appendChild(btn);
  }

  const entries = Object.entries(jobs).filter(([name]) => name !== "terminal");
  for (const [name, job] of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-ws-icon-btn";
    btn.title = job.label || name;
    btn.innerHTML = renderIcon(job.icon || "mdi-play", job.icon_color, iconSize);
    btn.addEventListener("click", () => onJobClick(name, job));
    container.appendChild(btn);
  }
}

function bindLongPress(el, { onLongPress, onClick, delay = 800 } = {}) {
  let timer = null;
  let fired = false;
  el.addEventListener("touchstart", () => {
    fired = false;
    timer = setTimeout(() => { fired = true; onLongPress(); }, delay);
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    clearTimeout(timer);
    if (fired) { e.preventDefault(); fired = false; }
  });
  el.addEventListener("touchmove", () => clearTimeout(timer), { passive: true });
  if (onClick) {
    el.addEventListener("click", (e) => { if (!fired) onClick(e); });
  }
}

function renderIcon(icon, iconColor, size = 16) {
  if (!icon) return "";
  if (icon.startsWith("data:image/")) {
    return `<img src="${icon}" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  if (icon.startsWith("favicon:")) {
    const domain = icon.slice("favicon:".length);
    return `<img src="${faviconUrl(domain)}" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
  }
  const colorStyle = iconColor ? ` style="color:${escapeHtml(iconColor)}"` : "";
  return `<span class="mdi ${escapeHtml(icon)}"${colorStyle}></span>`;
}

