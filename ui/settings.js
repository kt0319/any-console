function applyPanelBottom() {
  document.querySelector(".main-panel").classList.toggle("panel-bottom", panelBottom);
}

function showSettingsView(viewId) {
  for (const id of ["settings-menu-view", "settings-ws-visibility", "settings-server-info-view"]) {
    $(id).style.display = id === viewId ? "" : "none";
  }
}

function openSettings() {
  showSettingsView("settings-menu-view");
  $("settings-title").textContent = "設定";
  $("settings-modal").style.display = "flex";
}

function closeSettings() {
  $("settings-modal").style.display = "none";
}

function openSettingsWsVisibility() {
  $("settings-title").textContent = "ワークスペース設定";
  showSettingsView("settings-ws-visibility");
  const list = $("ws-check-list");
  list.innerHTML = "";
  for (const ws of allWorkspaces) {
    const visible = !ws.hidden;
    const item = document.createElement("div");
    item.className = "ws-check-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = visible;
    checkbox.dataset.ws = ws.name;
    checkbox.addEventListener("change", (e) => {
      toggleWorkspace(ws.name, e.target.checked);
    });

    const iconBtn = document.createElement("button");
    iconBtn.type = "button";
    iconBtn.className = "ws-icon-edit-btn";
    iconBtn.innerHTML = ws.icon ? renderIcon(ws.icon, ws.icon_color, 18) : '<span class="mdi mdi-console" style="color:var(--text-muted)"></span>';
    iconBtn.addEventListener("click", () => openWsIconPicker(ws));

    const label = document.createElement("span");
    label.className = "ws-check-label";
    label.textContent = ws.name;

    const iconsWrap = document.createElement("div");
    iconsWrap.className = "ws-setting-icons";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "ws-add-item-btn";
    addBtn.innerHTML = '<i class="mdi mdi-plus"></i>';
    addBtn.addEventListener("click", () => {
      $("settings-modal").style.display = "none";
      selectedWorkspace = ws.name;
      openItemCreateModal(ws.name, "job");
    });

    item.appendChild(checkbox);
    item.appendChild(iconBtn);
    item.appendChild(label);
    item.appendChild(iconsWrap);
    item.appendChild(addBtn);
    list.appendChild(item);

    loadSettingsWsIcons(iconsWrap, ws);
  }
  $("settings-modal").style.display = "flex";
}

async function openSettingsServerInfo() {
  $("settings-title").textContent = "サーバー情報";
  showSettingsView("settings-server-info-view");
  $("settings-modal").style.display = "flex";
  const list = $("server-info-list");
  list.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>';

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
    const res = await apiFetch("/system/info");
    if (!res) return;
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

function loadSettingsWsIcons(container, ws) {
  loadWsIconButtons(container, ws, 16,
    (link, i) => {
      $("settings-modal").style.display = "none";
      openItemEditModal("link", {
        workspace: ws.name, index: i,
        label: link.label || link.url,
        url: link.url,
        icon: link.icon,
        iconColor: link.icon_color,
      }, "settings");
    },
    (name, job) => {
      $("settings-modal").style.display = "none";
      openItemEditModal("job", {
        workspace: ws.name,
        name,
        label: job.label || name,
        icon: job.icon,
        iconColor: job.icon_color,
        command: job.command || "",
        confirm: job.confirm,
      }, "settings");
    },
  );
}

function openWsIconPicker(ws) {
  openIconPicker(async (icon, color) => {
    try {
      const res = await apiFetch(workspaceApiPath(ws.name, "/config"), {
        method: "PUT",
        body: { icon, icon_color: color },
      });
      if (!res) return;
      if (!res.ok) {
        const data = await res.json();
        showToast(data.detail || "保存に失敗しました");
        return;
      }
      ws.icon = icon;
      ws.icon_color = color;
      openSettingsWsVisibility();
      showToast("アイコンを更新しました", "success");
    } catch (e) {
      showToast(e.message);
    }
  }, ws.icon, ws.icon_color);
}

async function toggleWorkspace(name, visible) {
  const ws = allWorkspaces.find((w) => w.name === name);
  if (!ws) return;
  const hidden = !visible;
  try {
    const res = await apiFetch(workspaceApiPath(name, "/config"), {
      method: "PUT",
      body: { icon: ws.icon || "", icon_color: ws.icon_color || "", hidden },
    });
    if (!res || !res.ok) {
      showToast("設定の保存に失敗しました", "error");
      return;
    }
  } catch (e) {
    showToast(e.message, "error");
    return;
  }
  ws.hidden = hidden;
  let selectionCleared = false;
  if (!visible && selectedWorkspace === name) {
    selectedWorkspace = null;
    selectionCleared = true;
  }
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
  hideFormError("clone-error");
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
    const res = await apiFetch("/github/repos");
    if (!res) return;
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
  const outputEl = $("clone-output");

  if (!url) {
    showFormError("clone-error", cloneTab === "github" ? "リポジトリを選択してください" : "URLを入力してください");
    return;
  }

  hideFormError("clone-error");
  outputEl.style.display = "block";
  outputEl.textContent = "cloning...";
  $("clone-submit").disabled = true;

  try {
    const res = await apiFetch("/workspaces", {
      method: "POST",
      body: { url, name: name || null },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status === "error") {
      showFormError("clone-error", data.detail || data.stderr || "クローンに失敗しました");
      outputEl.style.display = "none";
      $("clone-submit").disabled = false;
      return;
    }
    outputEl.textContent = `${data.name} をクローンしました`;
    closeCloneModal();
    await loadWorkspaces();
    openSettingsWsVisibility();
  } catch (e) {
    showFormError("clone-error", e.message);
    outputEl.style.display = "none";
    $("clone-submit").disabled = false;
  }
}

async function exportSettings() {
  try {
    const res = await apiFetch("/settings/export");
    if (!res || !res.ok) {
      showToast("エクスポートに失敗しました", "error");
      return;
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pi-console-config.json";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("設定をエクスポートしました", "success");
  } catch (e) {
    showToast(e.message, "error");
  }
}

function importSettings() {
  const input = $("settings-import-file");
  input.value = "";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await apiFetch("/settings/import", {
        method: "POST",
        body: data,
      });
      if (!res || !res.ok) {
        showToast("インポートに失敗しました", "error");
        return;
      }
      showToast("設定をインポートしました", "success");
      closeSettings();
      await loadWorkspaces();
    } catch (e) {
      showToast(e.message, "error");
    }
  };
  input.click();
}
