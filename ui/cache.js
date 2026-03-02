const WORKSPACES_CACHE_KEY = "pi_console_cache_workspaces";
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
  return { jobs };
}

function getWorkspaceMetaCache(workspaceName) {
  const cached = workspaceMetaCache.get(workspaceName);
  if (cached) return cloneWorkspaceMeta(cached);

  const stored = readJsonCache(WORKSPACE_META_CACHE_PREFIX + workspaceName);
  if (!stored || typeof stored !== "object") return null;
  if (!stored.jobs) return null;
  workspaceMetaCache.set(workspaceName, stored);
  return cloneWorkspaceMeta(stored);
}

function setWorkspaceMetaCache(workspaceName, jobs) {
  const data = {
    jobs: jobs || {},
    fetchedAt: Date.now(),
  };
  workspaceMetaCache.set(workspaceName, data);
  writeJsonCache(WORKSPACE_META_CACHE_PREFIX + workspaceName, data);
}

function invalidateWorkspaceMetaCache(workspaceName = null) {
  if (workspaceName) {
    workspaceMetaCache.delete(workspaceName);
    workspaceMetaInFlight.delete(workspaceName);
    try {
      localStorage.removeItem(WORKSPACE_META_CACHE_PREFIX + workspaceName);
    } catch {}
    return;
  }
  workspaceMetaCache.clear();
  workspaceMetaInFlight.clear();
  deleteByPrefix(WORKSPACE_META_CACHE_PREFIX);
}

function invalidateGithubReposCache() {
  githubReposCache = null;
  githubReposInFlight = null;
  try {
    localStorage.removeItem(GITHUB_REPOS_CACHE_KEY);
  } catch {}
}

function getWorkspacesCache() {
  return readJsonCache(WORKSPACES_CACHE_KEY);
}

function setWorkspacesCache(workspaces) {
  writeJsonCache(WORKSPACES_CACHE_KEY, workspaces);
}

function invalidateWorkspacesCache() {
  try {
    localStorage.removeItem(WORKSPACES_CACHE_KEY);
  } catch {}
}

function clearPersistedApiCaches() {
  invalidateWorkspacesCache();
  invalidateWorkspaceMetaCache();
  invalidateGithubReposCache();
}

async function fetchWorkspaceJobsAndLinks(workspaceName, { forceRefresh = false } = {}) {
  syncCacheOwnerToken();
  if (!workspaceName) return { jobs: {} };

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
    let fetched = false;
    try {
      const jobsRes = await apiFetch(workspaceApiPath(workspaceName, "/jobs"));
      if (jobsRes && jobsRes.ok) {
        jobs = await jobsRes.json();
        fetched = true;
      }
    } catch (e) {
      console.error("fetchWorkspaceJobsAndLinks failed:", e);
    }

    if (fetched) {
      setWorkspaceMetaCache(workspaceName, jobs);
      return { jobs };
    }
    return stale ? { jobs: stale.jobs } : { jobs: {} };
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

async function loadWorkspaceIconButtons(container, ws, iconSize, onJobClick) {
  const { jobs } = await fetchWorkspaceJobsAndLinks(ws.name);
  let addedCount = 0;

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
