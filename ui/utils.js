function $(id) {
  return document.getElementById(id);
}

function showToast(message, type = "error") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    el.addEventListener("transitionend", () => el.remove());
  }, 3000);
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
  const res = await fetch(endpoint, { method, headers, body });
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

function addLongPressEditHandler(btn, openEditFn) {
  let holdTimer = null;
  const startHold = () => { holdTimer = setTimeout(openEditFn, 600); };
  const cancelHold = () => clearTimeout(holdTimer);
  btn.addEventListener("contextmenu", (e) => { e.preventDefault(); openEditFn(); });
  btn.addEventListener("touchstart", startHold, { passive: true });
  btn.addEventListener("touchend", cancelHold);
  btn.addEventListener("touchmove", cancelHold);
  btn.addEventListener("mousedown", (e) => { if (e.button === 0) startHold(); });
  btn.addEventListener("mouseup", cancelHold);
  btn.addEventListener("mouseleave", cancelHold);
}
