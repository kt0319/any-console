let JOBS = {};

function saveToken(val) {
  localStorage.setItem("pi_console_token", val);
  document.cookie = `pi_console_token=${encodeURIComponent(val)};path=/;max-age=31536000;SameSite=Strict`;
}

function clearToken() {
  localStorage.removeItem("pi_console_token");
  document.cookie = "pi_console_token=;path=/;max-age=0;SameSite=Strict";
}

function loadToken() {
  const ls = localStorage.getItem("pi_console_token");
  if (ls) return ls;
  const match = document.cookie.match(/(?:^|;\s*)pi_console_token=([^;]*)/);
  if (match) {
    const val = decodeURIComponent(match[1]);
    if (val) {
      localStorage.setItem("pi_console_token", val);
      return val;
    }
  }
  return "";
}

let token = loadToken();
let selectedJob = null;
let allWorkspaces = [];
let selectedWorkspace = localStorage.getItem("pi_console_workspace") || null;
let hiddenWorkspaces = JSON.parse(localStorage.getItem("hidden_workspaces") || "[]");
let runningJobName = null;
let launchingTerminal = false;
let cachedBranches = [];
let tabs = [];
let activeTabId = null;
let terminalIdCounter = 0;
let orphanSessions = [];
let closedSessionUrls = new Set();


const TERMINAL_TABS_KEY = "pi_console_terminal_tabs";
const QUICK_KEYS = [
  { label: "\u232B", key: "Backspace", code: "Backspace", keyCode: 8 },
  { label: "\u2190", key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  { label: "\u2193", key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  { label: "\u2191", key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  { label: "\u2192", key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  { label: "\u21B5", key: "Enter", code: "Enter", keyCode: 13 },
];
const EXTRA_KEYS = [
  { label: "1", key: "1", code: "Digit1", keyCode: 49 },
  { label: "2", key: "2", code: "Digit2", keyCode: 50 },
  { label: "3", key: "3", code: "Digit3", keyCode: 51 },
  { label: "4", key: "4", code: "Digit4", keyCode: 52 },
  { label: "5", key: "5", code: "Digit5", keyCode: 53 },
  { label: "6", key: "6", code: "Digit6", keyCode: 54 },
  { label: "7", key: "7", code: "Digit7", keyCode: 55 },
  { label: "8", key: "8", code: "Digit8", keyCode: 56 },
  { label: "9", key: "9", code: "Digit9", keyCode: 57 },
  { label: "0", key: "0", code: "Digit0", keyCode: 48 },
  { label: "Esc", key: "Escape", code: "Escape", keyCode: 27 },
  { label: "S-Tab", shift: true, key: "Tab", code: "Tab", keyCode: 9 },
  { label: "Tab", key: "Tab", code: "Tab", keyCode: 9 },
  { label: "Ctrl+C", ctrl: true, key: "c", code: "KeyC", keyCode: 67 },
  { label: "/", key: "/", code: "Slash", keyCode: 191 },
  { label: "Del", key: "Delete", code: "Delete", keyCode: 46 },
];
const AUTO_REFRESH_INTERVAL = 10000;
let autoRefreshTimer = null;
let autoRefreshing = false;

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

async function refreshCurrentWorkspaceStatus() {
  if (!selectedWorkspace) return;
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) return;
    const ws = await res.json();
    const idx = allWorkspaces.findIndex((w) => w.name === selectedWorkspace);
    if (idx >= 0) {
      allWorkspaces[idx] = ws;
    }
    await updateHeaderInfo();
  } catch {}
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(async () => {
    if (document.hidden || autoRefreshing) return;
    autoRefreshing = true;
    try {
      if (selectedWorkspace) await refreshCurrentWorkspaceStatus();
      await fetchOrphanSessions();
    } finally {
      autoRefreshing = false;
    }
  }, AUTO_REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

async function checkToken() {
  try {
    const res = await fetch("/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { ok: false, auth: false, error: "認証に失敗しました" };
    return { ok: true };
  } catch (e) {
    return { ok: false, auth: true, error: `サーバーに接続できません: ${e.message}` };
  }
}

let handlingUnauthorized = false;

async function handleUnauthorized(caller) {
  if (handlingUnauthorized || !token) return false;
  handlingUnauthorized = true;
  console.warn(`[auth] 401 from: ${caller || "unknown"}, verifying token...`);
  try {
    const res = await fetch("/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      console.warn("[auth] token rejected by /auth/check, logging out");
      clearToken();
      token = "";
      showLogin();
      return true;
    }
    console.warn("[auth] token still valid, ignoring 401");
  } catch {
  } finally {
    handlingUnauthorized = false;
  }
  return false;
}

async function login() {
  const input = $("token-input");
  token = input.value.trim();
  if (!token) return;

  const result = await checkToken();
  if (result.ok) {
    saveToken(token);
    $("login-error").style.display = "none";
    showApp();
    await initApp();
  } else {
    showToast(result.error);
    token = "";
  }
}

async function restoreTerminalTabs() {
  const saved = JSON.parse(localStorage.getItem(TERMINAL_TABS_KEY) || "[]");
  if (saved.length === 0) return;
  const lastActive = localStorage.getItem("pi_console_active_tab");

  try {
    const res = await fetch("/terminal/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      localStorage.removeItem(TERMINAL_TABS_KEY);
      return;
    }
    const sessions = await res.json();
    const aliveUrls = new Set(sessions.map((s) => s.url));

    const alive = saved.filter((t) => aliveUrls.has(t.url));
    if (alive.length === 0) {
      localStorage.removeItem(TERMINAL_TABS_KEY);
      return;
    }
    for (const t of alive) {
      addTerminalTab(t.url, t.label, t.id, true);
    }
    const restoreId = lastActive && tabs.some((t) => t.id === lastActive)
      ? lastActive
      : alive[alive.length - 1].id;
    switchTab(restoreId);
  } catch {
    localStorage.removeItem(TERMINAL_TABS_KEY);
  }
}

function setLoadingStatus(text) {
  $("output").innerHTML = `<div class="empty-state">${escapeHtml(text)}</div>`;
}

async function initApp() {
  setLoadingStatus("ワークスペースを読み込み中...");
  await loadWorkspaces();
  if (selectedWorkspace && !visibleWorkspaces().some((ws) => ws.name === selectedWorkspace)) {
    selectedWorkspace = null;
    localStorage.removeItem("pi_console_workspace");
  }
  setLoadingStatus("ワークスペース情報を取得中...");
  renderWorkspaceSelects();
  await updateHeaderInfo();
  setLoadingStatus("ジョブを読み込み中...");
  await loadJobsForWorkspace();
  renderJobMenu();
  const savedTabs = JSON.parse(localStorage.getItem(TERMINAL_TABS_KEY) || "[]");
  if (savedTabs.length > 0) {
    setLoadingStatus("ターミナルを復元中...");
    await restoreTerminalTabs();
  }
  await fetchOrphanSessions();
  if (!selectedWorkspace) {
    setLoadingStatus("ワークスペースを選択してください");
  } else {
    $("output").innerHTML = '<div class="empty-state"></div>';
  }
}

async function loadWorkspaces() {
  try {
    const res = await fetch("/workspaces", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      allWorkspaces = await res.json();
      renderWorkspaceSelects();
    }
  } catch {
    allWorkspaces = [];
  }
}

function visibleWorkspaces() {
  return allWorkspaces.filter((ws) => !hiddenWorkspaces.includes(ws.name));
}

function renderWorkspaceSelects() {
  renderHeaderWsSelect();
}

function renderHeaderWsSelect() {
  const btn = $("ws-select-btn");
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  btn.textContent = ws ? (ws.branch ? `${ws.name} (${ws.branch})` : ws.name) : "Workspace...";
}

function toggleWsSelectDropdown() {
  const dropdown = $("ws-select-dropdown");
  const btn = $("ws-select-btn");
  if (dropdown.style.display !== "none") {
    dropdown.style.display = "none";
    btn.classList.remove("active");
    return;
  }
  dropdown.innerHTML = "";
  for (const ws of visibleWorkspaces()) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ws-select-item" + (ws.name === selectedWorkspace ? " selected" : "");
    item.textContent = ws.branch ? `${ws.name} (${ws.branch})` : ws.name;
    item.addEventListener("click", async () => {
      dropdown.style.display = "none";
      btn.classList.remove("active");
      selectedWorkspace = ws.name;
      localStorage.setItem("pi_console_workspace", ws.name);
      renderHeaderWsSelect();
      await updateHeaderInfo();
      await loadJobsForWorkspace();
    });
    dropdown.appendChild(item);
  }
  const rect = btn.getBoundingClientRect();
  dropdown.style.top = rect.bottom + 4 + "px";
  dropdown.style.left = rect.left + "px";
  dropdown.style.width = rect.width + "px";
  dropdown.style.display = "block";
  btn.classList.add("active");
}

function updateGithubLink(ws) {
  const link = $("github-link");
  const sep = $("github-sep");
  const issuesLink = $("github-issues");
  const pullsLink = $("github-pulls");
  const actionsLink = $("github-actions");
  const githubEls = [link, issuesLink, pullsLink, actionsLink, sep];
  if (!ws || !ws.github_url) {
    githubEls.forEach(el => el.style.display = "none");
    return;
  }
  const branch = ws.branch || "main";
  const baseUrl = ws.github_url;
  const webUrl = `${baseUrl}/tree/${encodeURIComponent(branch)}`;
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  if (isMobile) {
    const path = baseUrl.replace(/^https?:\/\/github\.com/, "");
    link.href = `github://github.com${path}/tree/${encodeURIComponent(branch)}`;
    link.addEventListener("click", function fallback(e) {
      setTimeout(() => { window.open(webUrl, "_blank"); }, 500);
    }, { once: true });
  } else {
    link.href = webUrl;
  }
  issuesLink.href = `${baseUrl}/issues`;
  pullsLink.href = `${baseUrl}/pulls`;
  actionsLink.href = `${baseUrl}/actions`;
  githubEls.forEach(el => el.style.display = "block");
}

async function updateHeaderInfo() {
  const mainGitStatusEl = $("main-git-status");

  if (!selectedWorkspace) {
    mainGitStatusEl.innerHTML = "";
    $("clean-dirty-status").innerHTML = "";
    $("header-commit-msg").textContent = "ワークスペースを選択してください";
    $("header-row2").style.display = "flex";
    updateGithubLink(null);
    updateGitActions(null);
    return;
  }
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);

  let cleanDirtyHtml = "";
  if (ws && ws.clean === false) {
    let statParts = [];
    if (ws.changed_files > 0) statParts.push(`<span class="stat-files">${ws.changed_files}F</span>`);
    if (ws.insertions > 0) statParts.push(`<span class="stat-add">+${ws.insertions}</span>`);
    if (ws.deletions > 0) statParts.push(`<span class="stat-del">-${ws.deletions}</span>`);
    const statText = statParts.length > 0 ? statParts.join(" ") : "\u25cf";
    cleanDirtyHtml = `<span class="git-badge dirty" id="dirty-badge">${statText}</span>`;
  }
  $("clean-dirty-status").innerHTML = cleanDirtyHtml;

  const dirtyBadge = $("dirty-badge");
  if (dirtyBadge) {
    dirtyBadge.addEventListener("click", openDiffModal);
  }

  updateGithubLink(ws);
  mainGitStatusEl.innerHTML = "";
  updateGitActions(ws);
  const commitMsgEl = $("header-commit-msg");
  if (ws && ws.last_commit_message) {
    const ago = ws.last_commit ? formatTimeAgo(ws.last_commit) : "";
    commitMsgEl.innerHTML = `<span class="commit-msg-text">${escapeHtml(ws.last_commit_message)}</span>${ago ? `<span class="commit-msg-ago">${ago}</span>` : ""}`;
  } else {
    commitMsgEl.innerHTML = "";
  }

  await loadBranches();
}

function updateGitActions(ws) {
  const actions = $("git-actions");
  if (!selectedWorkspace || !ws) {
    actions.style.display = "none";
    return;
  }
  actions.style.display = "flex";

  const pullBtn = $("pull-btn");
  const pushBtn = $("push-btn");
  const pullCount = $("pull-count");
  const pushCount = $("push-count");

  pullBtn.style.display = ws.behind > 0 ? "" : "none";
  pushBtn.style.display = ws.ahead > 0 ? "" : "none";
  pullCount.textContent = ws.behind > 0 ? ws.behind : "";
  pushCount.textContent = ws.ahead > 0 ? ws.ahead : "";
  pullBtn.classList.toggle("has-count", ws.behind > 0);
  pushBtn.classList.toggle("has-count", ws.ahead > 0);
}

async function gitPull() {
  if (!selectedWorkspace) return;
  if (!confirm(`${selectedWorkspace} を pull しますか？`)) return;

  const pullBtn = $("pull-btn");
  pullBtn.classList.add("running");

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/pull`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast("pull 完了", "success");
    } else {
      showToast(`pull 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`pull エラー: ${e.message}`);
  } finally {
    pullBtn.classList.remove("running");
    await loadWorkspaces();
    await updateHeaderInfo();
  }
}

async function gitPush() {
  if (!selectedWorkspace) return;
  if (!confirm(`${selectedWorkspace} を push しますか？`)) return;

  const pushBtn = $("push-btn");
  pushBtn.classList.add("running");

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast("push 完了", "success");
    } else {
      showToast(`push 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`push エラー: ${e.message}`);
  } finally {
    pushBtn.classList.remove("running");
    await loadWorkspaces();
    await updateHeaderInfo();
  }
}

async function loadJobsForWorkspace() {
  if (!selectedWorkspace) {
    JOBS = {};
    selectedJob = null;
    renderJobMenu();
    $("output").innerHTML = '<div class="empty-state"></div>';
    return;
  }

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) {
      JOBS = {};
    } else {
      JOBS = await res.json();
    }
  } catch {
    JOBS = {};
  }

  selectedJob = null;
  renderJobMenu();
  renderTabBar();
}

function toggleCommitActionMenu(entry, hash, msg, branches = []) {
  const list = entry.closest(".git-log-list-modal");
  const menuEl = $("git-log-action-menu");
  const wasOpen = entry.classList.contains("action-open");

  if (list) {
    list.querySelectorAll(".git-log-commit").forEach((e) => e.classList.remove("action-open"));
  }

  if (wasOpen) {
    menuEl.style.display = "none";
    menuEl.innerHTML = "";
    resetCreateBranchArea();
    return;
  }

  entry.classList.add("action-open");
  menuEl.innerHTML = "";
  resetCreateBranchArea();

  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const switchActions = branches
    .filter((b) => !ws || b !== ws.branch)
    .map((b) => ({
      label: `switch: ${b}`,
      cls: "",
      fn: async () => {
        await checkoutBranch(b);
        closeGitLogModal();
        await loadWorkspaces();
        await updateHeaderInfo();
      },
    }));

  const actions = [
    ...switchActions,
    { label: "diff", cls: "", fn: () => { $("git-log-modal").style.display = "none"; openCommitDiffModal(hash, msg); } },
    { label: "branch", cls: "", fn: () => toggleCreateBranchArea(hash) },
    { label: "cherry-pick", cls: "", fn: () => execCommitAction("cherry-pick", hash) },
    { label: "revert", cls: "", fn: () => execCommitAction("revert", hash) },
    { label: "reset --soft", cls: "", fn: () => execCommitResetAction(hash, "soft") },
    { label: "reset --hard", cls: "commit-action-danger", fn: () => execCommitResetAction(hash, "hard") },
  ];

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "commit-action-item" + (action.cls ? ` ${action.cls}` : "");
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action.fn();
    });
    menuEl.appendChild(btn);
  }

  menuEl.style.display = "flex";
}

async function execCommitAction(action, hash) {
  if (!selectedWorkspace) return;
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commit_hash: hash }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${action} 完了`, "success");
    } else {
      showToast(`${action} 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`${action} エラー: ${e.message}`);
  }
  closeGitLogModal();
  await loadWorkspaces();
  await updateHeaderInfo();
}

async function execCommitResetAction(hash, mode) {
  if (!selectedWorkspace) return;
  const shortHash = hash.substring(0, 8);
  const warning = mode === "hard"
    ? `reset --hard ${shortHash} を実行します。作業ツリーの変更はすべて失われます。実行しますか？`
    : `reset --soft ${shortHash} を実行しますか？`;
  if (!confirm(warning)) return;
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/reset`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ commit_hash: hash, mode }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`reset --${mode} 完了`, "success");
    } else {
      showToast(`reset 失敗: ${data.stderr || data.stdout || "unknown error"}`);
    }
  } catch (e) {
    showToast(`reset エラー: ${e.message}`);
  }
  closeGitLogModal();
  await loadWorkspaces();
  await updateHeaderInfo();
}

function closeGitLogModal() {
  $("git-log-modal").style.display = "none";
  $("git-log-action-menu").style.display = "none";
  $("git-log-action-menu").innerHTML = "";
  resetCreateBranchArea();
}

function resetCreateBranchArea() {
  $("git-log-create-branch-area").style.display = "none";
  $("git-log-create-branch-submit").style.display = "none";
  $("git-log-branch-name").value = "";
  $("git-log-branch-error").style.display = "none";
}

let createBranchFromHash = null;

function toggleCreateBranchArea(hash) {
  const area = $("git-log-create-branch-area");
  const visible = area.style.display !== "none";
  if (visible) {
    resetCreateBranchArea();
  } else {
    createBranchFromHash = hash || null;
    area.style.display = "block";
    $("git-log-branch-name").focus();
  }
}

async function submitCreateBranch() {
  if (!selectedWorkspace) return;
  const branchName = $("git-log-branch-name").value.trim();
  const errorEl = $("git-log-branch-error");

  if (!branchName) {
    errorEl.textContent = "ブランチ名を入力してください";
    errorEl.style.display = "block";
    return;
  }
  if (!/^[a-zA-Z0-9_./-]+$/.test(branchName)) {
    errorEl.textContent = "ブランチ名に使えない文字が含まれています";
    errorEl.style.display = "block";
    return;
  }

  errorEl.style.display = "none";
  $("git-log-create-branch-submit").disabled = true;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/create-branch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ branch: branchName }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      errorEl.textContent = data.detail || data.stderr || "ブランチ作成に失敗しました";
      errorEl.style.display = "block";
      return;
    }
    closeGitLogModal();
    await loadWorkspaces();
    await updateHeaderInfo();
    renderJobMenu();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  } finally {
    $("git-log-create-branch-submit").disabled = false;
  }
}

const GIT_LOG_PAGE_SIZE = 30;
let gitLogLoaded = 0;
let gitLogLoading = false;
let gitLogHasMore = true;
const gitLogSeenHashes = new Set();

function renderGitLogEntries(listEl, stdout) {
  const lines = stdout.split("\n");
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;

    const entry = document.createElement("div");
    const commitMatch = line.match(/^(.*?)([0-9a-f]{40})\t(.+?)\t(.+?)\t(.*?)\t(.*)$/);
    if (commitMatch) {
      const graph = commitMatch[1].replace(/\*/g, " ");
      const hash = commitMatch[2];
      if (gitLogSeenHashes.has(hash)) continue;
      gitLogSeenHashes.add(hash);
      const time = commitMatch[3];
      const author = commitMatch[4];
      const refs = commitMatch[5];
      const msg = commitMatch[6];
      entry.className = "git-log-entry git-log-commit";
      let refsHtml = "";
      if (refs) {
        refsHtml = refs.split(",").map((r) => {
          const name = r.trim();
          if (!name || name === "origin/HEAD" || name === "HEAD") return "";
          const isTag = name.startsWith("tag: ");
          const isHead = name.startsWith("HEAD -> ");
          const remoteMatch = name.match(/^(origin|upstream)\/(.*)/);
          const isRemote = remoteMatch && !isTag && !isHead;
          const cls = isTag ? "git-ref-tag" : isHead ? "git-ref-head" : isRemote ? "git-ref-remote" : "git-ref-branch";
          let label;
          if (isRemote) {
            const icon = remoteMatch[1] === "origin" ? "mdi-github" : "mdi-server";
            label = `<span class="mdi ${icon}"></span> ${escapeHtml(remoteMatch[2])}`;
          } else if (isTag) {
            label = `<span class="mdi mdi-tag-outline"></span> ${escapeHtml(name.replace("tag: ", ""))}`;
          } else if (isHead) {
            const branchName = name.replace("HEAD -> ", "");
            label = `<span class="mdi mdi-source-branch"></span> ${escapeHtml(branchName)}`;
          } else {
            label = `<span class="mdi mdi-source-branch"></span> ${escapeHtml(name)}`;
          }
          return `<span class="git-ref ${cls}">${label}</span>`;
        }).join("");
      }
      entry.innerHTML =
        `<span class="git-log-entry-body">` +
          (refsHtml ? `<span class="git-log-entry-refs">${refsHtml}</span>` : "") +
          `<span class="git-log-entry-row1"><span class="git-log-entry-msg">${escapeHtml(msg)}</span></span>` +
          `<span class="git-log-entry-meta"><span class="git-log-entry-time">${escapeHtml(time)}</span><span class="git-log-entry-author">${escapeHtml(author)}</span></span>` +
        `</span>`;
      const branchSet = new Set();
      if (refs) {
        for (const r of refs.split(",")) {
          const name = r.trim();
          if (!name || name === "origin/HEAD" || name === "HEAD") continue;
          if (name.startsWith("HEAD -> ")) {
            branchSet.add(name.replace("HEAD -> ", ""));
          } else if (name.startsWith("tag: ")) {
            continue;
          } else {
            const rm = name.match(/^(?:origin|upstream)\/(.*)/);
            branchSet.add(rm ? rm[1] : name);
          }
        }
      }
      const branches = [...branchSet];
      entry.addEventListener("click", () => {
        toggleCommitActionMenu(entry, hash, msg, branches);
      });
      count++;
    } else {
      continue;
    }
    listEl.appendChild(entry);
  }
  return count;
}

async function loadMoreGitLog() {
  if (!selectedWorkspace || gitLogLoading || !gitLogHasMore) return;
  gitLogLoading = true;

  const listEl = $("git-log-list-modal");
  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/git-log?limit=${GIT_LOG_PAGE_SIZE}&skip=${gitLogLoaded}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok" || !data.stdout) {
      gitLogHasMore = false;
      return;
    }
    const count = renderGitLogEntries(listEl, data.stdout);
    gitLogLoaded += count;
    if (count < GIT_LOG_PAGE_SIZE) {
      gitLogHasMore = false;
    }
  } catch (e) {
    gitLogHasMore = false;
  } finally {
    gitLogLoading = false;
  }
}

async function openGitLogModal() {
  if (!selectedWorkspace) return;

  const listEl = $("git-log-list-modal");
  listEl.innerHTML = '<div class="git-log-entry-msg" style="color:var(--text-muted);padding:16px">読み込み中...</div>';
  $("git-log-modal").style.display = "flex";

  gitLogLoaded = 0;
  gitLogLoading = false;
  gitLogHasMore = true;
  gitLogSeenHashes.clear();

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/git-log?limit=${GIT_LOG_PAGE_SIZE}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      listEl.innerHTML = `<div style="color:var(--error);padding:16px">${escapeHtml(data.detail || data.stderr || "failed to load git log")}</div>`;
      return;
    }
    if (!data.stdout) {
      listEl.innerHTML = '<div style="color:var(--text-muted);padding:16px">ログがありません</div>';
      return;
    }

    listEl.innerHTML = "";
    const count = renderGitLogEntries(listEl, data.stdout);
    gitLogLoaded = count;
    if (count < GIT_LOG_PAGE_SIZE) {
      gitLogHasMore = false;
    }
  } catch (e) {
    listEl.innerHTML = `<div style="color:var(--error);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

async function openCommitDiffModal(commitHash, commitMsg) {
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  fileList.innerHTML = '<span class="diff-file-tag">loading...</span>';
  diffContent.textContent = "";
  $("diff-modal").querySelector("h3").textContent = commitMsg || "変更内容";
  $("diff-modal").style.display = "flex";

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/diff/${encodeURIComponent(commitHash)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      fileList.innerHTML = "";
      diffContent.textContent = data.detail || data.stderr || "diff の取得に失敗しました";
      return;
    }

    renderDiffFileList(fileList, data.files, data.diff || "");
    diffContent.textContent = "";
    if (data.diff) {
      diffContent.appendChild(colorDiff(data.diff));
    } else {
      diffContent.textContent = "差分なし";
    }
  } catch (e) {
    fileList.innerHTML = "";
    diffContent.textContent = e.message;
  }
}

async function loadBranches() {
  cachedBranches = [];
  if (!selectedWorkspace) return;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/branches`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    cachedBranches = await res.json();
  } catch {}
}

async function checkoutBranch(branch) {
  if (!selectedWorkspace || !branch) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  if (ws && ws.branch === branch) return;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ branch }),
    });

    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }

    const data = await res.json();
    const statusText = data.status || (res.ok ? "ok" : "error");

    if (statusText === "ok") {
      await loadWorkspaces();
      await updateHeaderInfo();
      renderJobMenu();
    } else {
      switchTab(null);
      let html = `<div class="output-status"><span class="status-badge error">${escapeHtml(statusText)}</span></div>`;
      if (!res.ok && data.detail) {
        html += `\n<span style="color:var(--error)">${escapeHtml(data.detail)}</span>`;
      }
      if (data.stdout) html += escapeHtml(data.stdout);
      if (data.stderr) {
        html += `\n<span style="color:var(--error)">${escapeHtml(data.stderr)}</span>`;
      }
      $("output").innerHTML = html;
    }
  } catch (e) {
    switchTab(null);
    $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`;
  }
}

function colorDiff(text) {
  if (!text) return "";
  const frag = document.createDocumentFragment();
  for (const line of text.split("\n")) {
    const span = document.createElement("span");
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      span.className = "diff-line-header";
    } else if (line.startsWith("@@")) {
      span.className = "diff-line-range";
    } else if (line.startsWith("+")) {
      span.className = "diff-line-add";
    } else if (line.startsWith("-")) {
      span.className = "diff-line-del";
    }
    span.textContent = line;
    frag.appendChild(span);
    frag.appendChild(document.createTextNode("\n"));
  }
  return frag;
}

function splitDiffByFile(diffText) {
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

let diffChunks = {};
let diffFullText = "";

function renderDiffFileList(fileList, files, diffText) {
  diffChunks = splitDiffByFile(diffText);
  diffFullText = diffText;
  fileList.innerHTML = "";

  if (files.length === 0) {
    fileList.innerHTML = '<span class="diff-file-tag">変更ファイルなし</span>';
    return;
  }

  const allTag = document.createElement("span");
  allTag.className = "diff-file-tag active";
  allTag.textContent = "すべて";
  allTag.addEventListener("click", () => selectDiffFile(null));
  fileList.appendChild(allTag);

  for (const f of files) {
    const tag = document.createElement("span");
    tag.className = "diff-file-tag";
    tag.dataset.file = f;
    tag.textContent = f;
    tag.addEventListener("click", () => selectDiffFile(f));
    fileList.appendChild(tag);
  }
}

function selectDiffFile(file) {
  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  for (const tag of fileList.querySelectorAll(".diff-file-tag")) {
    if (file === null) {
      tag.classList.toggle("active", !tag.dataset.file);
    } else {
      tag.classList.toggle("active", tag.dataset.file === file);
    }
  }
  diffContent.textContent = "";
  const text = file ? (diffChunks[file] || "") : diffFullText;
  if (text) {
    diffContent.appendChild(colorDiff(text));
  } else {
    diffContent.textContent = file ? "このファイルのdiffはありません" : "差分なし";
  }
  diffContent.scrollTop = 0;
}

async function openDiffModal() {
  if (!selectedWorkspace) return;
  $("diff-modal").querySelector("h3").textContent = "変更内容";

  const fileList = $("diff-file-list");
  const diffContent = $("diff-content");
  fileList.innerHTML = '<span class="diff-file-tag">loading...</span>';
  diffContent.textContent = "";
  $("diff-modal").style.display = "flex";

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/diff`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      fileList.innerHTML = "";
      diffContent.textContent = data.detail || "diff の取得に失敗しました";
      return;
    }

    renderDiffFileList(fileList, data.files, data.diff || "");
    diffContent.textContent = "";
    if (data.diff) {
      diffContent.appendChild(colorDiff(data.diff));
    } else {
      diffContent.textContent = "差分なし（untracked files のみの可能性）";
    }
  } catch (e) {
    fileList.innerHTML = "";
    diffContent.textContent = e.message;
  }
}

function closeDiffModal() {
  $("diff-modal").style.display = "none";
}

function openSettings() {
  $("settings-menu").style.display = "";
  $("settings-ws-visibility").style.display = "none";
  $("settings-server-info-view").style.display = "none";
  $("settings-title").textContent = "設定";
  $("settings-modal").style.display = "flex";
}

function openSettingsWsVisibility() {
  $("settings-menu").style.display = "none";
  $("settings-title").textContent = "表示するワークスペース";
  const list = $("ws-check-list");
  list.innerHTML = "";
  for (const ws of allWorkspaces) {
    const visible = !hiddenWorkspaces.includes(ws.name);
    const item = document.createElement("label");
    item.className = "ws-check-item";
    item.innerHTML = `<input type="checkbox" data-ws="${escapeHtml(ws.name)}" ${visible ? "checked" : ""} />${escapeHtml(ws.name)}`;
    item.querySelector("input").addEventListener("change", (e) => {
      toggleWorkspace(ws.name, e.target.checked);
    });
    list.appendChild(item);
  }
  $("settings-ws-visibility").style.display = "";
}

async function openSettingsServerInfo() {
  $("settings-menu").style.display = "none";
  $("settings-title").textContent = "サーバー情報";
  const list = $("server-info-list");
  list.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>';
  $("settings-server-info-view").style.display = "";

  const labels = {
    hostname: "ホスト名",
    ip: "IPアドレス",
    os: "OS",
    uptime: "稼働時間",
    cpu_temp: "CPU温度",
    memory: "メモリ",
    disk: "ディスク",
  };

  try {
    const res = await fetch("/system/info", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) {
      list.innerHTML = '<div style="color:var(--error);padding:16px">取得に失敗しました</div>';
      return;
    }
    const data = await res.json();
    list.innerHTML = "";
    for (const [key, label] of Object.entries(labels)) {
      if (!(key in data)) continue;
      const row = document.createElement("div");
      row.className = "server-info-row";
      row.innerHTML = `<span class="server-info-label">${escapeHtml(label)}</span><span class="server-info-value">${escapeHtml(String(data[key]))}</span>`;
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div style="color:var(--error);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

function closeSettings() {
  $("settings-modal").style.display = "none";
}

function settingsLogout() {
  clearToken();
  token = "";
  closeSettings();
  showLogin();
}

let cloneTab = "github";
let selectedCloneUrl = "";
let githubRepos = [];

async function openCloneModal() {
  $("clone-url").value = "";
  $("clone-name").value = "";
  $("clone-error").style.display = "none";
  $("clone-output").style.display = "none";
  $("clone-output").textContent = "";
  $("clone-submit").disabled = false;
  selectedCloneUrl = "";
  switchCloneTab("github");
  $("clone-modal").style.display = "flex";
  await loadGithubRepos();
}

function closeCloneModal() {
  $("clone-modal").style.display = "none";
}

function switchCloneTab(tab) {
  cloneTab = tab;
  for (const btn of document.querySelectorAll(".clone-tab")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  $("clone-tab-github").style.display = tab === "github" ? "block" : "none";
  $("clone-tab-url").style.display = tab === "url" ? "block" : "none";
  if (tab === "url") {
    $("clone-url").focus();
  }
}

async function loadGithubRepos() {
  const listEl = $("clone-repo-list");
  listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';

  try {
    const res = await fetch("/github/repos", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) {
      const data = await res.json();
      listEl.innerHTML = `<div class="clone-repo-error">${escapeHtml(data.detail || "取得に失敗しました")}</div>`;
      return;
    }
    githubRepos = await res.json();
    renderGithubRepos();
  } catch (e) {
    listEl.innerHTML = `<div class="clone-repo-error">${escapeHtml(e.message)}</div>`;
  }
}

function renderGithubRepos() {
  const listEl = $("clone-repo-list");
  if (githubRepos.length === 0) {
    listEl.innerHTML = '<div class="clone-repo-empty">リポジトリがありません</div>';
    return;
  }
  listEl.innerHTML = "";
  for (const repo of githubRepos) {
    const item = document.createElement("div");
    item.className = "clone-repo-item" + (selectedCloneUrl === repo.url ? " selected" : "");
    item.innerHTML = `<div class="clone-repo-name">${escapeHtml(repo.nameWithOwner)}</div>` +
      (repo.description ? `<div class="clone-repo-desc">${escapeHtml(repo.description)}</div>` : "");
    item.addEventListener("click", () => selectGithubRepo(repo.url));
    listEl.appendChild(item);
  }
}

function selectGithubRepo(url) {
  selectedCloneUrl = url;
  renderGithubRepos();
}

async function submitClone() {
  const url = cloneTab === "github" ? selectedCloneUrl : $("clone-url").value.trim();
  const name = $("clone-name").value.trim();
  const errorEl = $("clone-error");
  const outputEl = $("clone-output");

  if (!url) {
    errorEl.textContent = cloneTab === "github" ? "リポジトリを選択してください" : "URLを入力してください";
    errorEl.style.display = "block";
    return;
  }

  errorEl.style.display = "none";
  outputEl.style.display = "block";
  outputEl.textContent = "cloning...";
  $("clone-submit").disabled = true;

  try {
    const res = await fetch("/workspaces", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, name: name || null }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok || data.status === "error") {
      errorEl.textContent = data.detail || data.stderr || "クローンに失敗しました";
      errorEl.style.display = "block";
      outputEl.style.display = "none";
      $("clone-submit").disabled = false;
      return;
    }
    outputEl.textContent = `${data.name} をクローンしました`;
    closeCloneModal();
    await loadWorkspaces();
    openSettings();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
    outputEl.style.display = "none";
    $("clone-submit").disabled = false;
  }
}

function toggleWorkspace(name, visible) {
  let selectionCleared = false;
  if (visible) {
    hiddenWorkspaces = hiddenWorkspaces.filter((n) => n !== name);
  } else {
    if (!hiddenWorkspaces.includes(name)) {
      hiddenWorkspaces.push(name);
    }
    if (selectedWorkspace === name) {
      selectedWorkspace = null;
      selectionCleared = true;
    }
  }
  localStorage.setItem("hidden_workspaces", JSON.stringify(hiddenWorkspaces));
  renderWorkspaceSelects();
  if (selectionCleared) {
    updateHeaderInfo();
    loadJobsForWorkspace();
  }
}

function renderJobMenu() {
  const dropdown = $("menu-dropdown");
  dropdown.querySelectorAll(".menu-dynamic").forEach((el) => el.remove());

  if (!selectedWorkspace) return;

  const refNode = $("menu-settings");
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const currentBranch = ws ? ws.branch : null;

  if (cachedBranches.length > 0) {
    const branchLabel = document.createElement("div");
    branchLabel.className = "menu-section-label menu-dynamic";
    branchLabel.textContent = "ブランチ";
    dropdown.insertBefore(branchLabel, refNode);

    for (const b of cachedBranches) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-item menu-dynamic";
      btn.textContent = b === currentBranch ? `${b} ✓` : b;
      if (b === currentBranch) btn.style.color = "var(--accent)";
      btn.addEventListener("click", () => {
        closeMenu();
        if (b !== currentBranch) checkoutBranch(b);
      });
      dropdown.insertBefore(btn, refNode);
    }

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "menu-item menu-dynamic";
    moreBtn.style.color = "var(--text-muted)";
    moreBtn.textContent = "more...";
    moreBtn.addEventListener("click", () => {
      closeMenu();
      openBranchModal();
    });
    dropdown.insertBefore(moreBtn, refNode);

    const branchSep = document.createElement("div");
    branchSep.className = "menu-separator menu-dynamic";
    dropdown.insertBefore(branchSep, refNode);
  }

  const entries = Object.entries(JOBS).filter(([name]) => name !== "terminal");
  if (entries.length > 0) {
    const jobLabel = document.createElement("div");
    jobLabel.className = "menu-section-label menu-dynamic";
    jobLabel.textContent = "ジョブ";
    dropdown.insertBefore(jobLabel, refNode);

    for (const [name, job] of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-item menu-dynamic";
      const label = job.label || name;
      const isRunning = runningJobName === name;
      if (job.open_url) {
        btn.innerHTML = `<span class="menu-job-url-icon">⧉</span> ${escapeHtml(label)}`;
      } else if (isRunning) {
        btn.innerHTML = `${escapeHtml(label)} <span class="job-state">◌</span>`;
      } else {
        btn.textContent = label;
      }
      btn.addEventListener("click", () => {
        closeMenu();
        if (job.open_url) {
          window.open(job.open_url, "_blank");
        } else {
          openJobConfirmModal(name);
        }
      });
      let holdTimer = null;
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        closeMenu();
        deleteJob(name);
      });
      btn.addEventListener("touchstart", () => {
        holdTimer = setTimeout(() => { closeMenu(); deleteJob(name); }, 600);
      }, { passive: true });
      btn.addEventListener("touchend", () => clearTimeout(holdTimer));
      btn.addEventListener("touchmove", () => clearTimeout(holdTimer));
      dropdown.insertBefore(btn, refNode);
    }
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "menu-item menu-dynamic";
  addBtn.style.color = "var(--text-muted)";
  addBtn.textContent = "+ ジョブ追加";
  addBtn.addEventListener("click", () => {
    closeMenu();
    openJobCreateModal();
  });
  dropdown.insertBefore(addBtn, refNode);

  const sep = document.createElement("div");
  sep.className = "menu-separator menu-dynamic";
  dropdown.insertBefore(sep, refNode);
}

async function openBranchModal() {
  const listEl = $("branch-list");
  listEl.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
  $("branch-modal").style.display = "flex";

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/branches/remote`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    if (!res.ok) {
      listEl.innerHTML = '<div class="clone-repo-error">取得に失敗しました</div>';
      return;
    }
    const remoteBranches = await res.json();
    if (remoteBranches.length === 0) {
      listEl.innerHTML = '<div class="clone-repo-empty">リモートブランチがありません</div>';
      return;
    }

    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    const currentBranch = ws ? ws.branch : null;

    listEl.innerHTML = "";
    for (const branch of remoteBranches) {
      const item = document.createElement("div");
      item.className = "branch-item";
      if (branch === currentBranch) {
        item.classList.add("current");
        item.textContent = `${branch} ✓`;
      } else if (cachedBranches.includes(branch)) {
        item.classList.add("local-exists");
        item.textContent = branch;
      } else {
        item.textContent = branch;
      }
      item.addEventListener("click", () => {
        if (branch === currentBranch) return;
        $("branch-modal").style.display = "none";
        checkoutBranch(branch);
      });
      listEl.appendChild(item);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="clone-repo-error">${escapeHtml(e.message)}</div>`;
  }
}

function closeBranchModal() {
  $("branch-modal").style.display = "none";
}

function openJobCreateModal() {
  $("job-create-name").value = "";
  $("job-create-label").value = "";
  $("job-create-script").value = "";
  $("job-create-url").value = "";
  $("job-create-error").style.display = "none";
  $("job-create-modal").style.display = "flex";
  $("job-create-name").focus();
}

function closeJobCreateModal() {
  $("job-create-modal").style.display = "none";
}

async function submitJobCreate() {
  const name = $("job-create-name").value.trim();
  const label = $("job-create-label").value.trim();
  const script = $("job-create-script").value;
  const openUrl = $("job-create-url").value.trim();
  const errorEl = $("job-create-error");

  if (!name) {
    errorEl.textContent = "ジョブ名を入力してください";
    errorEl.style.display = "block";
    return;
  }
  if (!script.trim()) {
    errorEl.textContent = "スクリプトを入力してください";
    errorEl.style.display = "block";
    return;
  }

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, label: label || name, script, open_url: openUrl }),
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.detail || "作成に失敗しました";
      errorEl.style.display = "block";
      return;
    }
    closeJobCreateModal();
    await loadJobsForWorkspace();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = "block";
  }
}

async function deleteJob(jobName) {
  if (!selectedWorkspace) return;
  if (!confirm(`ジョブ '${jobName}' を削除しますか？`)) return;

  try {
    const res = await fetch(`/workspaces/${encodeURIComponent(selectedWorkspace)}/jobs/${encodeURIComponent(jobName)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(data.detail || "削除に失敗しました")}`;
      return;
    }
    if (selectedJob === jobName) selectedJob = null;
    await loadJobsForWorkspace();
  } catch (e) {
    $("output").innerHTML = `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`;
  }
}

function openJobConfirmModal(name) {
  const job = JOBS[name];
  if (!job) return;
  selectedJob = name;
  $("job-confirm-title").textContent = job.label || name;

  const argsContainer = $("job-confirm-args");
  argsContainer.innerHTML = "";
  if (job.args && job.args.length > 0) {
    for (const arg of job.args) {
      const group = document.createElement("div");
      group.className = "arg-group";
      const label = document.createElement("label");
      label.className = "arg-label";
      label.textContent = arg.name;
      if (arg.required) label.innerHTML += ' <span class="required">*</span>';
      group.appendChild(label);

      if (Array.isArray(arg.values) && arg.values.length > 0) {
        const radioGroup = document.createElement("div");
        radioGroup.className = "radio-group";
        for (const val of arg.values) {
          const lbl = document.createElement("label");
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `confirm-arg-${arg.name}`;
          radio.value = val;
          if (val === arg.values[0]) radio.checked = true;
          const span = document.createElement("span");
          span.className = "radio-btn";
          span.textContent = val;
          lbl.appendChild(radio);
          lbl.appendChild(span);
          radioGroup.appendChild(lbl);
        }
        group.appendChild(radioGroup);
      }
      argsContainer.appendChild(group);
    }
  } else {
    const commands = extractCommands(job.script_content || "");
    if (commands) {
      const preview = escapeHtml(commands.length > 300 ? commands.slice(0, 300) + "..." : commands);
      argsContainer.innerHTML = `<pre class="script-preview">${preview}</pre>`;
    }
  }

  $("job-confirm-modal").style.display = "flex";
}

function closeJobConfirmModal() {
  $("job-confirm-modal").style.display = "none";
}

function collectConfirmArgs() {
  const job = JOBS[selectedJob];
  if (!job || !job.args) return {};
  const args = {};
  for (const arg of job.args) {
    const checked = document.querySelector(`input[name="confirm-arg-${arg.name}"]:checked`);
    if (checked) args[arg.name] = checked.value;
  }
  return args;
}

function extractCommands(content) {
  if (!content) return "";
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("#")) return false;
      if (trimmed === "set -euo pipefail") return false;
      if (trimmed === "set -eu") return false;
      if (trimmed === "set -e") return false;
      return true;
    })
    .join("\n")
    .trim();
}

function saveTerminalTabs() {
  const data = tabs.filter((t) => t.type === "terminal").map((t) => ({ id: t.id, url: t.url, label: t.label }));
  localStorage.setItem(TERMINAL_TABS_KEY, JSON.stringify(data));
  if (activeTabId) {
    localStorage.setItem("pi_console_active_tab", activeTabId);
  } else {
    localStorage.removeItem("pi_console_active_tab");
  }
  updateOrphanSessions();
}

async function fetchOrphanSessions() {
  try {
    const res = await fetch("/terminal/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      orphanSessions = [];
      renderTabBar();
      return;
    }
    const sessions = await res.json();
    updateOrphanFromSessions(sessions);
  } catch {
    orphanSessions = [];
  }
  renderTabBar();
}

function updateOrphanSessions() {
  const localUrls = new Set(tabs.filter((t) => t.type === "terminal").map((t) => t.url));
  orphanSessions = orphanSessions.filter((s) => !localUrls.has(s.url));
}

function updateOrphanFromSessions(sessions) {
  const localUrls = new Set(tabs.filter((t) => t.type === "terminal").map((t) => t.url));
  orphanSessions = sessions
    .filter((s) => !localUrls.has(s.url) && !closedSessionUrls.has(s.url))
    .map((s) => ({ url: s.url, workspace: s.workspace, expiresIn: s.expires_in }));
  for (const url of closedSessionUrls) {
    if (!sessions.some((s) => s.url === url)) closedSessionUrls.delete(url);
  }
}

function joinOrphanSession(url, workspace) {
  const label = workspace || "terminal";
  addTerminalTab(url, label);
  orphanSessions = orphanSessions.filter((s) => s.url !== url);
  renderTabBar();
}

function updateQuickInputVisibility() {
  const el = $("quick-input");
  if (!el) return;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  el.style.display = activeTab && activeTab.type === "terminal" ? "" : "none";
}

function getTerminalTextarea() {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return null;
  const iframe = $(`frame-${activeTabId}`);
  if (!iframe) return null;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return null;
    return doc.querySelector(".xterm-helper-textarea");
  } catch {}
  return null;
}

function dispatchKeyToTerminal(keyDef) {
  const textarea = getTerminalTextarea();
  if (!textarea) return;
  const eventInit = {
    key: keyDef.key,
    code: keyDef.code || "",
    keyCode: keyDef.keyCode || 0,
    which: keyDef.keyCode || 0,
    ctrlKey: !!keyDef.ctrl,
    bubbles: true,
    cancelable: true,
  };
  textarea.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  if (keyDef.char && !keyDef.ctrl) {
    textarea.dispatchEvent(new KeyboardEvent("keypress", {
      ...eventInit,
      charCode: keyDef.char.charCodeAt(0),
    }));
  }
  textarea.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  return textarea;
}

function sendKeyToTerminal(keyDef) {
  const textarea = getTerminalTextarea();
  if (!textarea) return;
  const origFocus = textarea.focus;
  textarea.focus = () => {};
  dispatchKeyToTerminal(keyDef);
  requestAnimationFrame(() => { textarea.focus = origFocus; });
}

function sendTextToTerminal(text) {
  const textarea = getTerminalTextarea();
  if (!textarea) return;
  textarea.focus();
  textarea.value = text;
  textarea.dispatchEvent(new InputEvent("input", {
    data: text,
    inputType: "insertText",
    bubbles: true,
  }));
}

async function uploadClipboardImage(file) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return;

  console.warn("[paste] uploading image:", file.type, file.size);
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/upload-image", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      console.error("[paste] upload failed:", res.status, await res.text());
      return;
    }
    const data = await res.json();
    console.warn("[paste] upload ok:", data.path);
    if (data.path) sendTextToTerminal(data.path);
  } catch (err) {
    console.error("[paste] upload error:", err);
  }
}

function attachPasteListener(iframe) {
  try {
    const doc = iframe.contentDocument;
    if (!doc) {
      console.warn("[paste] contentDocument is null (cross-origin?)");
      return;
    }
    console.warn("[paste] listener attached to iframe");
    doc.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      console.warn("[paste] paste event fired, items:", items?.length);
      if (!items) return;
      for (const item of items) {
        console.warn("[paste] item:", item.kind, item.type);
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (file) uploadClipboardImage(file);
          return;
        }
      }
    }, { capture: true });
  } catch (err) {
    console.error("[paste] attachPasteListener failed:", err);
  }
}

function createQuickKeyBtn(keyDef) {
  const btn = document.createElement("div");
  btn.className = "quick-key";
  btn.textContent = keyDef.label;
  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    btn.classList.add("pressed");
  }, { passive: false });
  btn.addEventListener("touchend", (e) => {
    e.preventDefault();
    btn.classList.remove("pressed");
    sendKeyToTerminal(keyDef);
  });
  btn.addEventListener("touchcancel", () => btn.classList.remove("pressed"));
  return btn;
}

function initQuickInput() {
  const panel = $("quick-input-panel");

  const toggleBtn = document.createElement("div");
  toggleBtn.className = "quick-key quick-key-toggle";
  toggleBtn.innerHTML = '<span class="mdi mdi-keyboard-outline"></span>';
  panel.appendChild(toggleBtn);

  const quickKeyBtns = QUICK_KEYS.map(k => createQuickKeyBtn(k));
  for (const btn of quickKeyBtns) panel.appendChild(btn);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) uploadClipboardImage(file);
    fileInput.value = "";
  });
  panel.appendChild(fileInput);

  const container = $("quick-input");
  const openFilePicker = () => {
    container.style.display = "none";
    fileInput.click();
  };
  const restorePanel = () => { container.style.display = ""; };
  fileInput.addEventListener("change", restorePanel);
  window.addEventListener("focus", () => {
    if (container.style.display === "none") restorePanel();
  });

  const imgBtn = document.createElement("div");
  imgBtn.className = "quick-key";
  imgBtn.textContent = "+";
  imgBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  imgBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    openFilePicker();
  });
  imgBtn.addEventListener("click", openFilePicker);
  panel.insertBefore(imgBtn, quickKeyBtns[0]);

  const extraPanel = document.createElement("div");
  extraPanel.className = "quick-extra-panel";
  extraPanel.style.display = "none";

  const row1 = document.createElement("div");
  row1.className = "quick-extra-row";
  const row2 = document.createElement("div");
  row2.className = "quick-extra-row";

  for (const keyDef of EXTRA_KEYS) {
    const isDigit = keyDef.code && keyDef.code.startsWith("Digit");
    (isDigit ? row1 : row2).appendChild(createQuickKeyBtn(keyDef));
  }

  extraPanel.appendChild(row1);
  extraPanel.appendChild(row2);

  const closeExtra = () => {
    extraPanel.style.display = "none";
    toggleBtn.classList.remove("active");
  };
  extraPanel.addEventListener("touchend", (e) => {
    if (e.target.closest(".quick-key")) closeExtra();
  });
  panel.addEventListener("touchend", (e) => {
    if (e.target.closest(".quick-key") && !e.target.closest(".quick-key-toggle")) closeExtra();
  });
  window.addEventListener("blur", closeExtra);
  document.addEventListener("touchend", (e) => {
    if (extraPanel.style.display !== "none" && !e.target.closest(".quick-key-toggle") && !extraPanel.contains(e.target)) {
      closeExtra();
    }
  });

  toggleBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  toggleBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    const open = extraPanel.style.display === "none";
    extraPanel.style.display = open ? "flex" : "none";
    toggleBtn.classList.toggle("active", open);
  });

  container.insertBefore(extraPanel, panel);
}

function addTerminalTab(url, workspace, tabId, skipSwitch) {
  const id = tabId || `term-${++terminalIdCounter}`;
  if (tabId) {
    const m = tabId.match(/^term-(\d+)$/);
    if (m) terminalIdCounter = Math.max(terminalIdCounter, parseInt(m[1]));
  }
  const label = workspace || "terminal";
  if (tabs.some((t) => t.id === id)) return;
  tabs.push({ id, type: "terminal", url, label });

  const iframe = document.createElement("iframe");
  iframe.className = "terminal-frame";
  iframe.id = `frame-${id}`;
  iframe.src = url;
  iframe.style.display = "none";
  iframe.addEventListener("load", () => {
    attachPasteListener(iframe);
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        doc.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
        doc.addEventListener("touchmove", (e) => {
          if (e.touches.length > 1) e.preventDefault();
        }, { passive: false });
      }
    } catch (err) {}
  });
  $("output-container").appendChild(iframe);

  if (skipSwitch) return;
  saveTerminalTabs();
  switchTab(id);
}

function setOutputTab(id, label, htmlContent) {
  const existing = tabs.find((t) => t.id === id);
  if (existing) {
    existing.label = label;
    const el = $(`frame-${id}`);
    if (el) el.innerHTML = htmlContent;
    switchTab(id);
    return;
  }
  tabs.push({ id, type: "output", label });
  const div = document.createElement("div");
  div.className = "output-area";
  div.id = `frame-${id}`;
  div.innerHTML = htmlContent;
  div.style.display = "none";
  $("output-container").appendChild(div);
  switchTab(id);
}

function removeTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (tab && tab.type === "terminal" && tab.url) {
    closedSessionUrls.add(tab.url);
    const match = tab.url.match(/\/terminal\/s\/([^/]+)\//);
    if (match) {
      fetch(`/terminal/sessions/${match[1]}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }
  tabs = tabs.filter((t) => t.id !== id);
  const el = $(`frame-${id}`);
  if (el) el.remove();
  saveTerminalTabs();
  if (activeTabId === id) {
    switchTab(tabs.length > 0 ? tabs[tabs.length - 1].id : null);
  } else {
    renderTabBar();
  }
}

function switchTab(id) {
  activeTabId = id;
  if (id) {
    localStorage.setItem("pi_console_active_tab", id);
  } else {
    localStorage.removeItem("pi_console_active_tab");
  }
  $("output").style.display = id === null ? "" : "none";
  for (const tab of tabs) {
    const el = $(`frame-${tab.id}`);
    if (el) {
      if (tab.id === id) {
        el.style.display = tab.type === "terminal" ? "block" : "";
        if (tab.type === "terminal") {
          try { el.contentWindow.focus(); } catch {}
        }
      } else {
        el.style.display = "none";
      }
    }
  }
  updateQuickInputVisibility();
  renderTabBar();
}

function renderTabBar() {
  const bar = $("tab-bar");
  bar.style.display = "flex";

  let html = "";
  for (const tab of tabs) {
    html += `<button class="tab-btn${activeTabId === tab.id ? " active" : ""}" data-tab="${tab.id}">`
      + `${escapeHtml(tab.label)}<span class="tab-close" data-close="${tab.id}">&times;</span></button>`;
  }
  for (const s of orphanSessions) {
    const label = s.workspace || "terminal";
    html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.url)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" title="他デバイスのセッション">`
      + `${escapeHtml(label)}</button>`;
  }
  html += '<button class="tab-add-btn" id="tab-add-btn" title="ターミナルを開く">+</button>';
  bar.innerHTML = html;

  bar.querySelectorAll(".tab-btn:not(.orphan)").forEach((btn) => {
    let longPressTimer = null;
    let didLongPress = false;
    btn.addEventListener("touchstart", (e) => {
      didLongPress = false;
      longPressTimer = setTimeout(() => {
        didLongPress = true;
        if (confirm(`「${btn.textContent.replace("×", "").trim()}」を閉じますか？`)) {
          removeTab(btn.dataset.tab);
        }
      }, 500);
    }, { passive: true });
    btn.addEventListener("touchend", (e) => {
      clearTimeout(longPressTimer);
      if (didLongPress) e.preventDefault();
    });
    btn.addEventListener("touchmove", () => clearTimeout(longPressTimer));
    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close") || didLongPress) return;
      switchTab(btn.dataset.tab);
    });
  });
  bar.querySelectorAll(".tab-btn.orphan").forEach((btn) => {
    btn.addEventListener("click", () => {
      joinOrphanSession(btn.dataset.orphanUrl, btn.dataset.orphanWs);
    });
  });
  bar.querySelectorAll(".tab-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeTab(btn.dataset.close);
    });
  });
  $("tab-add-btn").addEventListener("click", () => runJob("terminal"));

  const activeBtn = bar.querySelector(".tab-btn.active");
  if (activeBtn) activeBtn.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function collectArgs() {
  const job = JOBS[selectedJob];
  if (!job || !job.args) return {};
  const args = {};
  for (const arg of job.args) {
    if (arg.required && Array.isArray(arg.values) && arg.values.length > 0) {
      args[arg.name] = arg.values[0];
    }
  }
  return args;
}

async function runJob(jobName = null, argsOverride = null) {
  const targetJob = jobName || selectedJob;
  if (!targetJob) return;
  const isTerminal = targetJob === "terminal";
  if (isTerminal) {
    if (launchingTerminal) return;
  } else {
    if (runningJobName) return;
  }
  if (selectedJob !== targetJob) {
    selectedJob = targetJob;
  }
  renderJobMenu();

  const args = argsOverride || collectArgs();
  const job = JOBS[targetJob] || {};
  const tabLabel = job.label || targetJob;
  const outputTabId = isTerminal ? `output-term-${Date.now()}` : `output-${targetJob}`;

  for (const arg of (job.args || [])) {
    if (arg.required && !args[arg.name]) {
      setOutputTab(outputTabId, tabLabel, `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(arg.name)} の既定値がありません`);
      return;
    }
  }

  if (isTerminal) {
    launchingTerminal = true;
  } else {
    runningJobName = targetJob;
  }
  renderJobMenu();
  setOutputTab(outputTabId, tabLabel, '<div class="output-status"><span class="status-badge running">running</span></div>');

  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ job: targetJob, args, workspace: selectedWorkspace }),
    });

    if (res.status === 401) {
      await handleUnauthorized();
      return;
    }

    const data = await res.json();
    const badgeClass = data.status === "ok" ? "ok" : "error";
    let html = `<div class="output-status"><span class="status-badge ${badgeClass}">${escapeHtml(data.status)}</span> exit: ${data.exit_code}</div>`;

    if (data.stdout) {
      html += escapeHtml(data.stdout);
    }
    if (data.stderr) {
      html += `\n<span style="color:var(--error)">${escapeHtml(data.stderr)}</span>`;
    }

    if (isTerminal && data.status === "ok" && data.terminal_url) {
      removeTab(outputTabId);
      addTerminalTab(data.terminal_url, selectedWorkspace);
      return;
    }

    setOutputTab(outputTabId, tabLabel, html);
  } catch (e) {
    setOutputTab(outputTabId, tabLabel, `<div class="output-status"><span class="status-badge error">error</span></div>${escapeHtml(e.message)}`);
  } finally {
    if (isTerminal) {
      launchingTerminal = false;
    } else {
      runningJobName = null;
    }
    renderJobMenu();
    loadWorkspaces().then(() => updateHeaderInfo());
  }
}

function toggleMenu() {
  const dd = $("menu-dropdown");
  const btn = $("menu-btn");
  if (dd.style.display === "none") {
    const rect = btn.getBoundingClientRect();
    dd.style.left = rect.left + "px";
    dd.style.top = rect.bottom + 4 + "px";
    dd.style.display = "block";
    btn.classList.add("active");
  } else {
    dd.style.display = "none";
    btn.classList.remove("active");
  }
}

function closeMenu() {
  $("menu-dropdown").style.display = "none";
  $("menu-btn").classList.remove("active");
}


function updateViewportHeight() {
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${vh}px`);
}

document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

document.addEventListener("DOMContentLoaded", async () => {
  updateViewportHeight();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateViewportHeight);
  }
  $("login-btn").addEventListener("click", login);
  $("token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  $("job-confirm-cancel").addEventListener("click", closeJobConfirmModal);
  $("job-confirm-cancel-x").addEventListener("click", closeJobConfirmModal);
  $("job-confirm-run").addEventListener("click", () => {
    const args = collectConfirmArgs();
    closeJobConfirmModal();
    runJob(null, args);
  });
  $("menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  $("menu-settings").addEventListener("click", () => {
    closeMenu();
    openSettings();
  });
  document.addEventListener("click", closeMenu);
  window.addEventListener("blur", closeMenu);
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-clone").addEventListener("click", () => {
    closeSettings();
    openCloneModal();
  });
  $("settings-visibility").addEventListener("click", openSettingsWsVisibility);
  $("settings-server-info").addEventListener("click", openSettingsServerInfo);
  $("settings-logout").addEventListener("click", settingsLogout);
  $("clone-cancel").addEventListener("click", closeCloneModal);
  $("clone-submit").addEventListener("click", submitClone);
  for (const tab of document.querySelectorAll(".clone-tab")) {
    tab.addEventListener("click", () => switchCloneTab(tab.dataset.tab));
  }
  $("branch-modal-close").addEventListener("click", closeBranchModal);
  $("diff-close").addEventListener("click", closeDiffModal);
  $("job-create-cancel").addEventListener("click", closeJobCreateModal);
  $("job-create-submit").addEventListener("click", submitJobCreate);
  $("ws-select-btn").addEventListener("click", toggleWsSelectDropdown);
  document.addEventListener("click", (e) => {
    if (!$("ws-select-wrap").contains(e.target)) {
      $("ws-select-dropdown").style.display = "none";
      $("ws-select-btn").classList.remove("active");
    }
  });
  $("pull-btn").addEventListener("click", gitPull);
  $("push-btn").addEventListener("click", gitPush);
  initQuickInput();
  $("header-commit-msg").addEventListener("click", openGitLogModal);
  $("git-log-close").addEventListener("click", closeGitLogModal);
  $("git-log-list-modal").addEventListener("scroll", (e) => {
    const el = e.target;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      loadMoreGitLog();
    }
  });
  $("git-log-create-branch-submit").addEventListener("click", submitCreateBranch);

  if (token) {
    const result = await checkToken();
    if (result.ok) {
      showApp();
      await initApp();
    } else if (!result.auth) {
      token = "";
      clearToken();
      showLogin();
    } else {
      showToast(result.error);
      showApp();
      await initApp();
    }
  } else {
    showLogin();
  }
});
