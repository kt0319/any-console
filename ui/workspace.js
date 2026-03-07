// @ts-check
import { allWorkspaces, setAllWorkspaces, selectedWorkspace, setSelectedWorkspace, token } from './state-core.js';
import { apiFetch, workspaceApiPath } from './api-client.js';
import { getWorkspacesCache, setWorkspacesCache } from './cache.js';
import { showToast, escapeHtml, buildWorkspaceHeaderNumstatHtml, $ } from './utils.js';
import { GitCore } from './git.js';

/**
 * @param {{ useCache?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function loadWorkspaces({ useCache = false } = {}) {
  let hasCacheHit = false;
  if (useCache) {
    const cached = getWorkspacesCache();
    if (cached && Array.isArray(cached) && cached.length > 0) {
      setAllWorkspaces(cached);
      hasCacheHit = true;
    }
  }
  const fetchPromise = (async () => {
    try {
      const res = await apiFetch("/workspaces");
      if (res && res.ok) {
        setAllWorkspaces(await res.json());
        setWorkspacesCache(allWorkspaces);
      }
    } catch (e) {
      if (allWorkspaces.length === 0) {
        showToast("ワークスペース一覧の取得に失敗しました", "error");
      }
    }
  })();
  if (!hasCacheHit) await fetchPromise;
}

/**
 * @returns {Array<object>}
 */
export function visibleWorkspaces() {
  return allWorkspaces.filter((ws) => !ws.hidden);
}

/**
 * @param {{ reloadBranches?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function refreshWorkspaceHeader(options = {}) {
  const { reloadBranches = true } = options;
  if (!selectedWorkspace) return;

  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  if (!ws) return;

  $("main-git-status").innerHTML = "";
  updatePullPushButtons(ws);
  const branch = ws.branch || "";
  const isDirty = ws.clean === false;
  const msg = isDirty ? "未コミットの変更" : (ws.last_commit_message || "");
  const msgClass = isDirty ? "commit-btn-msg commit-btn-msg-muted" : "commit-btn-msg";
  const numstatHtml = isDirty ? buildWorkspaceHeaderNumstatHtml(ws) : "";
  $("header-commit-msg").innerHTML =
    `<span class="commit-btn-branch">${escapeHtml(branch)}</span>` +
    `<span class="commit-btn-msg-wrap"><span class="${msgClass}">${escapeHtml(msg)}</span></span>` +
    numstatHtml;

  if (reloadBranches) {
    await GitCore.loadBranches();
  }
}

/**
 * @param {object} ws
 * @returns {void}
 */
export function updatePullPushButtons(ws) {
  const actions = $("git-actions");

  const pullBtn = $("pull-btn");
  const pushBtn = $("push-btn");
  const setUpstreamBtn = $("set-upstream-btn");
  const pushUpstreamBtn = $("push-upstream-btn");
  const pullCount = $("pull-count");
  const pushCount = $("push-count");
  const pushUpstreamCount = $("push-upstream-count");
  const hasUpstream = ws.has_upstream !== false;
  const hasRemoteBranch = ws.has_remote_branch === true;

  pullBtn.style.display = ws.behind > 0 ? "" : "none";
  pushBtn.style.display = hasUpstream && ws.ahead > 0 ? "" : "none";
  setUpstreamBtn.style.display = !hasUpstream && hasRemoteBranch ? "" : "none";
  pushUpstreamBtn.style.display = !hasUpstream && !hasRemoteBranch ? "" : "none";
  pullCount.textContent = ws.behind > 0 ? ws.behind : "";
  pushCount.textContent = ws.ahead > 0 ? ws.ahead : "";
  pushUpstreamCount.textContent = (!hasUpstream && !hasRemoteBranch) ? String(ws.ahead ?? 0) : "";
  pullBtn.classList.toggle("has-count", ws.behind > 0);
  pushBtn.classList.toggle("has-count", ws.ahead > 0);
  pushUpstreamBtn.classList.toggle("has-count", !hasUpstream && !hasRemoteBranch && ws.ahead > 0);
  actions.style.display = (ws.behind > 0 || ws.ahead > 0 || !hasUpstream) ? "flex" : "none";
}

/**
 * @returns {Promise<void>}
 */
export async function refreshCurrentWorkspaceStatus() {
  if (!selectedWorkspace) return;
  const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/status"));
  if (!res || !res.ok) return;
  const ws = await res.json();
  const idx = allWorkspaces.findIndex((w) => w.name === selectedWorkspace);
  if (idx >= 0) {
    const updated = [...allWorkspaces];
    updated[idx] = { ...allWorkspaces[idx], ...ws };
    setAllWorkspaces(updated);
  }
  await refreshWorkspaceHeader();
}

const STATUS_POLL_INTERVAL_MS = 10000;
let statusPollTimer = null;

function startStatusPolling() {
  if (statusPollTimer) return;
  statusPollTimer = setInterval(() => {
    if (document.visibilityState === "visible") {
      refreshCurrentWorkspaceStatus();
    }
  }, STATUS_POLL_INTERVAL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshCurrentWorkspaceStatus();
  }
});

startStatusPolling();

