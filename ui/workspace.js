async function loadWorkspaces() {
  try {
    const res = await apiFetch("/workspaces");
    if (res && res.ok) {
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
}

async function updateHeaderInfo() {
  const mainGitStatusEl = $("main-git-status");

  $("header-row2").style.display = "flex";
  if (!selectedWorkspace) {
    mainGitStatusEl.innerHTML = "";
    $("clean-dirty-status").innerHTML = "";
    const commitMsgBtn = $("header-commit-msg");
    commitMsgBtn.style.display = "";
    commitMsgBtn.innerHTML = `<span class="commit-btn-msg" style="color:var(--text-muted)">ワークスペースを選択してください</span>`;
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
  commitMsgBtn.style.display = "";
  if (ws) {
    const branch = ws.branch || "";
    const msg = ws.last_commit_message || "";
    commitMsgBtn.innerHTML = `<span class="commit-btn-branch">${escapeHtml(branch)}</span> <span class="commit-btn-msg">${escapeHtml(msg)}</span>`;
  } else {
    commitMsgBtn.innerHTML = `<span class="commit-btn-msg" style="color:var(--text-muted)">ワークスペースを選択してください</span>`;
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
  const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/status"));
  if (!res || !res.ok) return;
  const ws = await res.json();
  const idx = allWorkspaces.findIndex((w) => w.name === selectedWorkspace);
  if (idx >= 0) {
    allWorkspaces[idx] = ws;
  }
  await updateHeaderInfo();
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => runAutoRefresh(), AUTO_REFRESH_INTERVAL);
  document.addEventListener("visibilitychange", onVisibilityChangeForRefresh);
}

function onVisibilityChangeForRefresh() {
  if (document.visibilityState === "visible" && autoRefreshTimer) {
    runAutoRefresh();
  }
}

async function runAutoRefresh() {
  if (document.hidden || autoRefreshing) return;
  autoRefreshing = true;
  try {
    const health = await checkServerHealth();
    if (!health) {
      if (!serverDisconnected) {
        serverDisconnected = true;
        showToast("サーバーとの接続が切断されました", "error");
      }
    } else if (serverDisconnected) {
      location.reload();
      return;
    }
    if (health) {
      if (selectedWorkspace) await refreshCurrentWorkspaceStatus();
      await fetchOrphanSessions();
    }
  } catch {
  } finally {
    autoRefreshing = false;
  }
}

async function checkServerHealth() {
  try {
    const res = await fetch("/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  document.removeEventListener("visibilitychange", onVisibilityChangeForRefresh);
}

async function fetchWorkspace(name) {
  try {
    await apiFetch(workspaceApiPath(name, "/fetch"), { method: "POST" });
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
