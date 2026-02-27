function $(id) {
  return document.getElementById(id);
}

function safeFit(tab) {
  if (!tab || !tab.fitAddon) return;
  try { tab.fitAddon.fit(); } catch (e) { console.warn("fitAddon.fit failed:", e); }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch((e) => console.error("clipboard write failed:", e));
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
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.remove("show");
    el.addEventListener("transitionend", () => el.remove());
  };
  el.addEventListener("click", () => {
    copyToClipboard(text);
    dismiss();
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
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

function renderInlineStatusHtml(text, tone = "muted", centered = true) {
  const color = tone === "error" ? "var(--error)" : "var(--text-muted)";
  const align = centered ? "text-align:center;" : "";
  return `<div style="color:${color};padding:16px;${align}">${escapeHtml(text)}</div>`;
}

function setInlineStatus(container, text, tone = "muted", centered = true) {
  container.innerHTML = renderInlineStatusHtml(text, tone, centered);
}

async function fetchAndRenderWithStatus(
  container,
  endpoint,
  renderData,
  {
    loadingText = "読み込み中...",
    fetchErrorText = "取得に失敗しました",
    fetchErrorTone = "error",
    fetchErrorCentered = false,
    catchErrorTone = "error",
    catchErrorCentered = false,
  } = {},
) {
  setInlineStatus(container, loadingText);
  try {
    const res = await apiFetch(endpoint);
    if (!res || !res.ok) {
      setInlineStatus(container, fetchErrorText, fetchErrorTone, fetchErrorCentered);
      return false;
    }
    const data = await res.json();
    container.innerHTML = "";
    await renderData(data);
    return true;
  } catch (e) {
    setInlineStatus(container, e.message, catchErrorTone, catchErrorCentered);
    return false;
  }
}

function setCloneRepoStatus(container, variant, text) {
  container.innerHTML = `<div class="clone-repo-${variant}">${escapeHtml(text)}</div>`;
}

function getActionFailureMessage(data, fallback = "unknown error") {
  if (!data || typeof data !== "object") return fallback;
  return toDisplayMessage(data.stderr || data.stdout || data.detail, fallback);
}

async function postWorkspaceAction(workspace, endpoint, label, body = null) {
  try {
    const res = await apiFetch(workspaceApiPath(workspace, endpoint), {
      method: "POST",
      body,
    });
    if (!res) return null;
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${label} 完了`, "success");
      return data;
    }
    showToast(`${label} 失敗: ${getActionFailureMessage(data)}`);
    return data;
  } catch (e) {
    showToast(`${label} エラー: ${e.message}`);
    return null;
  }
}

async function deleteWorkspaceAction(
  workspace,
  endpoint,
  successMessage,
  defaultError = "削除に失敗しました",
) {
  try {
    const res = await apiFetch(workspaceApiPath(workspace, endpoint), { method: "DELETE" });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || defaultError);
      return false;
    }
    if (successMessage) showToast(successMessage, "success");
    return true;
  } catch (e) {
    showToast(`削除エラー: ${e.message}`);
    return false;
  }
}

async function putWorkspaceConfig(workspace, body) {
  try {
    const res = await apiFetch(workspaceApiPath(workspace, "/config"), {
      method: "PUT",
      body,
    });
    if (!res) return { ok: false, data: null };
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function workspaceApiPath(workspace, path = "") {
  return `/workspaces/${encodeURIComponent(workspace)}${path}`;
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

const WORKSPACE_META_CACHE_PREFIX = "pi_console_cache_workspace_meta:";
const GITHUB_REPOS_CACHE_KEY = "pi_console_cache_github_repos";
const CACHE_OWNER_KEY = "pi_console_cache_owner_token";
const workspaceMetaCache = new Map();
const workspaceMetaInFlight = new Map();
let githubReposCache = null;
let githubReposInFlight = null;

function cacheOwnerToken() {
  return token || localStorage.getItem("pi_console_token") || "";
}

function readJsonCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function deleteByPrefix(prefix) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {}
}

function syncCacheOwnerToken() {
  const owner = cacheOwnerToken();
  const cachedOwner = localStorage.getItem(CACHE_OWNER_KEY) || "";
  if (cachedOwner === owner) return;
  clearPersistedApiCaches();
  if (owner) {
    localStorage.setItem(CACHE_OWNER_KEY, owner);
  } else {
    localStorage.removeItem(CACHE_OWNER_KEY);
  }
}

function cloneWorkspaceMeta(meta) {
  const jobs = {};
  for (const [name, job] of Object.entries(meta.jobs || {})) {
    jobs[name] = job && typeof job === "object" ? { ...job } : job;
  }
  const links = Array.isArray(meta.links) ? meta.links.map((link) => ({ ...link })) : [];
  return { jobs, links };
}

function getWorkspaceMetaCache(workspaceName) {
  const cached = workspaceMetaCache.get(workspaceName);
  if (cached) return cloneWorkspaceMeta(cached);

  const stored = readJsonCache(WORKSPACE_META_CACHE_PREFIX + workspaceName);
  if (!stored || typeof stored !== "object") return null;
  if (!stored.jobs || !Array.isArray(stored.links)) return null;
  workspaceMetaCache.set(workspaceName, stored);
  return cloneWorkspaceMeta(stored);
}

function setWorkspaceMetaCache(workspaceName, jobs, links) {
  const data = {
    jobs: jobs || {},
    links: links || [],
    fetchedAt: Date.now(),
  };
  workspaceMetaCache.set(workspaceName, data);
  writeJsonCache(WORKSPACE_META_CACHE_PREFIX + workspaceName, data);
}

function invalidateWorkspaceMetaCache(workspaceName = null) {
  if (workspaceName) {
    workspaceMetaCache.delete(workspaceName);
    workspaceMetaInFlight.delete(workspaceName);
    try { localStorage.removeItem(WORKSPACE_META_CACHE_PREFIX + workspaceName); } catch {}
    return;
  }
  workspaceMetaCache.clear();
  workspaceMetaInFlight.clear();
  deleteByPrefix(WORKSPACE_META_CACHE_PREFIX);
}

function invalidateGithubReposCache() {
  githubReposCache = null;
  githubReposInFlight = null;
  try { localStorage.removeItem(GITHUB_REPOS_CACHE_KEY); } catch {}
}

function clearPersistedApiCaches() {
  invalidateWorkspaceMetaCache();
  invalidateGithubReposCache();
}

async function fetchWorkspaceJobsAndLinks(workspaceName, { forceRefresh = false } = {}) {
  syncCacheOwnerToken();
  if (!workspaceName) return { jobs: {}, links: [] };

  if (!forceRefresh) {
    const cached = getWorkspaceMetaCache(workspaceName);
    if (cached) return cached;
  }

  if (!forceRefresh && workspaceMetaInFlight.has(workspaceName)) {
    const inFlight = await workspaceMetaInFlight.get(workspaceName);
    return cloneWorkspaceMeta(inFlight);
  }

  const request = (async () => {
    const stale = workspaceMetaCache.get(workspaceName);
    let jobs = stale?.jobs || {};
    let links = stale?.links || [];
    let fetched = false;
    try {
      const [jobsRes, linksRes] = await Promise.all([
        apiFetch(workspaceApiPath(workspaceName, "/jobs")),
        apiFetch(workspaceApiPath(workspaceName, "/links")),
      ]);
      if (jobsRes && jobsRes.ok) {
        jobs = await jobsRes.json();
        fetched = true;
      }
      if (linksRes && linksRes.ok) {
        links = await linksRes.json();
        fetched = true;
      }
    } catch (e) {
      console.error("fetchWorkspaceJobsAndLinks failed:", e);
    }

    if (fetched) {
      setWorkspaceMetaCache(workspaceName, jobs, links);
      return { jobs, links };
    }
    return stale ? { jobs: stale.jobs, links: stale.links } : { jobs: {}, links: [] };
  })();

  workspaceMetaInFlight.set(workspaceName, request);
  try {
    const result = await request;
    return cloneWorkspaceMeta(result);
  } finally {
    workspaceMetaInFlight.delete(workspaceName);
  }
}

async function fetchGithubRepos({ forceRefresh = false } = {}) {
  syncCacheOwnerToken();

  if (!githubReposCache) {
    const stored = readJsonCache(GITHUB_REPOS_CACHE_KEY);
    if (stored && Array.isArray(stored.repos)) {
      githubReposCache = stored;
    }
  }

  if (!forceRefresh && githubReposCache) {
    return githubReposCache.repos.map((repo) => ({ ...repo }));
  }

  if (!forceRefresh && githubReposInFlight) {
    const inFlightRepos = await githubReposInFlight;
    return inFlightRepos.map((repo) => ({ ...repo }));
  }

  const request = (async () => {
    try {
      const res = await apiFetch("/github/repos");
      if (!res) throw new Error("取得に失敗しました");
      if (!res.ok) {
        let detail = "取得に失敗しました";
        try {
          const data = await res.json();
          if (data?.detail) detail = data.detail;
        } catch {}
        throw new Error(detail);
      }
      const repos = await res.json();
      githubReposCache = { repos, fetchedAt: Date.now() };
      writeJsonCache(GITHUB_REPOS_CACHE_KEY, githubReposCache);
      return repos;
    } catch (e) {
      if (githubReposCache) return githubReposCache.repos;
      throw e;
    }
  })();

  githubReposInFlight = request;
  try {
    const repos = await request;
    return repos.map((repo) => ({ ...repo }));
  } finally {
    githubReposInFlight = null;
  }
}

async function loadWorkspaceIconButtons(container, ws, iconSize, onLinkClick, onJobClick) {
  const { jobs, links } = await fetchWorkspaceJobsAndLinks(ws.name);
  let addedCount = 0;

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-ws-icon-btn picker-ws-link-btn";
    btn.title = link.label || link.url;
    btn.innerHTML = renderIcon(link.icon || "mdi-web", link.icon_color, iconSize);
    btn.addEventListener("click", () => onLinkClick(link, i));
    container.appendChild(btn);
    addedCount += 1;
  }

  const entries = Object.entries(jobs).filter(([name]) => name !== "terminal");
  for (const [name, job] of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-ws-icon-btn" + (job.terminal === false ? " picker-ws-job-direct" : "");
    btn.title = job.label || name;
    btn.innerHTML = renderIcon(job.icon || "mdi-play", job.icon_color, iconSize);
    btn.addEventListener("click", () => onJobClick(name, job));
    container.appendChild(btn);
    addedCount += 1;
  }

  return addedCount;
}

function bindLongPress(el, { onLongPress, onClick, delay = 800, moveThreshold = 20 } = {}) {
  let timer = null;
  let fired = false;
  let startX = 0, startY = 0;
  el.addEventListener("touchstart", (e) => {
    fired = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    const startEvt = e;
    el.classList.add("long-pressing");
    timer = setTimeout(() => { fired = true; el.classList.remove("long-pressing"); onLongPress(startEvt); }, delay);
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    clearTimeout(timer);
    el.classList.remove("long-pressing");
    if (fired) { e.preventDefault(); fired = false; }
  });
  el.addEventListener("touchmove", (e) => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (dx * dx + dy * dy > moveThreshold * moveThreshold) {
      clearTimeout(timer);
      el.classList.remove("long-pressing");
    }
  }, { passive: true });
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return;
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    el.classList.add("long-pressing");
    timer = setTimeout(() => { fired = true; el.classList.remove("long-pressing"); onLongPress(e); }, delay);
  });
  el.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") return;
    clearTimeout(timer);
    el.classList.remove("long-pressing");
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > moveThreshold * moveThreshold) {
      clearTimeout(timer);
      el.classList.remove("long-pressing");
    }
  });
  if (onClick) {
    el.addEventListener("click", (e) => { if (!fired) onClick(e); });
  }
}

const VALID_ICON_COLOR = /^#[0-9a-fA-F]{3,6}$/;

function renderIcon(icon, iconColor, size = 16) {
  if (!icon) return "";
  if (icon.startsWith("data:image/")) {
    return `<img src="${icon}" width="${size}" height="${size}" class="favicon-icon" alt="" />`;
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
