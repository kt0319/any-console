function openSettings() {
  $("settings-menu").style.display = "";
  $("settings-ws-visibility").style.display = "none";
  $("settings-server-info-view").style.display = "none";
  $("settings-title").textContent = "設定";
  $("settings-modal").style.display = "flex";
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

function openSettingsWsVisibility() {
  $("settings-menu").style.display = "none";
  $("settings-title").textContent = "ワークスペース設定";
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

function toSshUrl(url) {
  const m = url.match(/^https?:\/\/github\.com\/(.+)/);
  if (!m) return url;
  const path = m[1].replace(/\/$/, "");
  return `git@github.com:${path}.git`;
}

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
  let url = cloneTab === "github" ? selectedCloneUrl : $("clone-url").value.trim();
  url = toSshUrl(url);
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
