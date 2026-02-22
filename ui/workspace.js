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
}

function updateGithubLink(ws) {
  const link = $("github-link");
  const issuesLink = $("github-issues");
  const pullsLink = $("github-pulls");
  const actionsLink = $("github-actions");
  const githubEls = [link, issuesLink, pullsLink, actionsLink];
  if (!ws || !ws.github_url) {
    githubEls.forEach(el => el.style.display = "none");
    return;
  }
  const branch = ws.branch || "main";
  const baseUrl = ws.github_url;
  const path = baseUrl.replace(/^https?:\/\/github\.com/, "");
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  const scheme = isMobile ? "github://github.com" : baseUrl;
  link.href = isMobile ? `${scheme}${path}/tree/${encodeURIComponent(branch)}` : `${baseUrl}/tree/${encodeURIComponent(branch)}`;
  issuesLink.href = `${scheme}${isMobile ? path : ""}/issues`;
  pullsLink.href = `${scheme}${isMobile ? path : ""}/pulls`;
  actionsLink.href = `${scheme}${isMobile ? path : ""}/actions`;
  githubEls.forEach(el => el.style.display = "block");
}

async function updateHeaderInfo() {
  const mainGitStatusEl = $("main-git-status");

  if (!selectedWorkspace) {
    mainGitStatusEl.innerHTML = "";
    $("clean-dirty-status").innerHTML = "";
    $("header-commit-msg").style.display = "none";
    const activeTab = tabs.find((t) => t.id === activeTabId);
    $("header-row2").style.display = activeTab && activeTab.type === "terminal" ? "flex" : "none";
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
  const commitMsgBtn = $("header-commit-msg");
  commitMsgBtn.style.display = selectedWorkspace ? "" : "none";
  if (ws) {
    const branch = ws.branch || "";
    const msg = ws.last_commit_message || "";
    commitMsgBtn.innerHTML = `<span class="commit-btn-branch">${escapeHtml(branch)}</span> <span class="commit-btn-msg">${escapeHtml(msg)}</span>`;
  } else {
    commitMsgBtn.textContent = "";
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
  actions.style.display = (ws.behind > 0 || ws.ahead > 0) ? "flex" : "none";
}

async function refreshCurrentWorkspaceStatus() {
  if (!selectedWorkspace) return;
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
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(async () => {
    if (document.hidden || autoRefreshing) return;
    autoRefreshing = true;
    try {
      if (selectedWorkspace) await refreshCurrentWorkspaceStatus();
      await fetchOrphanSessions();
    } catch {
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

async function fetchWorkspace(name) {
  try {
    await fetch(`/workspaces/${encodeURIComponent(name)}/fetch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
}

function toggleMenu() {
  const modal = $("menu-modal");
  if (modal.style.display === "none") {
    modal.style.display = "flex";
  } else {
    closeMenu();
  }
}

function closeMenu() {
  $("menu-modal").style.display = "none";
}
