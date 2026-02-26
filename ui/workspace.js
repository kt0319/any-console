async function loadWorkspaces() {
  try {
    const res = await apiFetch("/workspaces");
    if (res && res.ok) {
      allWorkspaces = await res.json();
    }
  } catch (e) {
    showToast("ワークスペース一覧の取得に失敗しました", "error");
    allWorkspaces = [];
  }
}

function visibleWorkspaces() {
  return allWorkspaces.filter((ws) => !ws.hidden);
}

async function refreshWorkspaceHeader() {
  if (!selectedWorkspace) return;

  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  if (!ws) return;

  let cleanDirtyHtml = "";
  if (ws.clean === false) {
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

  $("main-git-status").innerHTML = "";
  updatePullPushButtons(ws);
  const branch = ws.branch || "";
  const msg = ws.last_commit_message || "";
  $("header-commit-msg").innerHTML = `<span class="commit-btn-branch">${escapeHtml(branch)}</span> <span class="commit-btn-msg">${escapeHtml(msg)}</span>`;

  await loadBranches();
}

function updatePullPushButtons(ws) {
  const actions = $("git-actions");

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
    allWorkspaces[idx] = { ...allWorkspaces[idx], ...ws };
  }
  await refreshWorkspaceHeader();
}

function startStatusPolling() {
  if (statusPollTimer) return;
  statusPollTimer = setInterval(() => pollWorkspaceStatus(), STATUS_POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisibilityChangeForRefresh);
}

function onVisibilityChangeForRefresh() {
  if (document.visibilityState === "visible" && statusPollTimer) {
    pollWorkspaceStatus();
  }
}

async function pollWorkspaceStatus() {
  if (document.hidden || isPollingStatus) return;
  isPollingStatus = true;
  try {
    const health = await checkServerHealth();
    if (!health) {
      if (!serverDisconnected) {
        serverDisconnected = true;
        showToast("サーバーとの接続が切断されました", "error");
      }
    } else if (serverDisconnected) {
      sessionStorage.setItem("pi_console_server_reloaded", "1");
      location.reload();
      return;
    }
    if (health) {
      if (selectedWorkspace) await refreshCurrentWorkspaceStatus();
      await fetchOrphanSessions();
    }
  } catch (e) {
    console.error("auto refresh failed:", e);
  } finally {
    isPollingStatus = false;
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

function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  document.removeEventListener("visibilitychange", onVisibilityChangeForRefresh);
}

async function gitFetchWorkspace(name) {
  try {
    await apiFetch(workspaceApiPath(name, "/fetch"), { method: "POST" });
  } catch (e) {
    console.error("gitFetchWorkspace failed:", e);
  }
}

