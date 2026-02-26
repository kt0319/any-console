function applyPanelBottom() {
  document.querySelector(".main-panel").classList.toggle("panel-bottom", panelBottom);
}

function showSettingsView(viewId) {
  for (const id of ["settings-menu-view", "settings-ws-visibility", "settings-ws-add-view", "settings-server-info-view", "settings-process-list-view", "settings-op-log-view"]) {
    const el = $(id);
    if (el) el.style.display = id === viewId ? "" : "none";
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

function createWsItemElements(ws) {
  const iconSpan = document.createElement("span");
  iconSpan.className = "ws-icon-display";
  iconSpan.innerHTML = ws.icon ? renderIcon(ws.icon, ws.icon_color, 18) : '<span class="mdi mdi-console" style="color:var(--text-muted)"></span>';
  const label = document.createElement("span");
  label.className = "ws-check-label";
  label.textContent = ws.name;
  return { iconSpan, label };
}

function renderWsVisibilityTo(container, onGearClick) {
  container.innerHTML = "";
  for (const ws of allWorkspaces) {
    const item = document.createElement("div");
    item.className = "ws-check-item";
    const { iconSpan, label } = createWsItemElements(ws);
    item.append(iconSpan, label);

    if (onGearClick) {
      const gearBtn = document.createElement("button");
      gearBtn.type = "button";
      gearBtn.className = "ws-gear-btn";
      gearBtn.innerHTML = '<span class="mdi mdi-cog"></span>';
      gearBtn.addEventListener("click", () => onGearClick(ws));
      item.appendChild(gearBtn);
    }

    container.appendChild(item);
  }
}

function renderWsVisibilityChecklistTo(container) {
  container.innerHTML = "";
  for (const ws of allWorkspaces) {
    const item = document.createElement("div");
    item.className = "ws-check-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !ws.hidden;
    checkbox.dataset.ws = ws.name;
    checkbox.addEventListener("change", (e) => toggleWorkspace(ws.name, e.target.checked));
    const { iconSpan, label } = createWsItemElements(ws);
    item.append(checkbox, iconSpan, label);
    container.appendChild(item);
  }
}

function openSettingsWsVisibility() {
  $("settings-title").textContent = "ワークスペース設定";
  showSettingsView("settings-ws-visibility");
  const wsCheckList = $("ws-check-list");
  renderWsVisibilityTo(wsCheckList, (ws) => {
    renderWsSettingsPane(wsCheckList, ws, () => openSettingsWsVisibility());
  });
  $("settings-modal").style.display = "flex";
}

function openSettingsWsAdd() {
  openCloneModal("visibility");
}

function renderWsSettingsPane(container, ws, onBack, setTitleFn) {
  container.innerHTML = "";
  const sub = document.createElement("div");
  sub.className = "split-tab-settings-sub";

  if (!setTitleFn) {
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "split-tab-settings-back";
    backBtn.innerHTML = '<span class="mdi mdi-arrow-left"></span> ' + escapeHtml(ws.name);
    backBtn.addEventListener("click", onBack);
    sub.appendChild(backBtn);
  } else {
    setTitleFn(ws.name, onBack);
  }

  const body = document.createElement("div");
  body.className = "split-tab-settings-body";
  sub.appendChild(body);
  container.appendChild(sub);

  const goBackToSettings = () => renderWsSettingsPane(container, ws, onBack, setTitleFn);

  const iconRow = document.createElement("div");
  iconRow.className = "ws-settings-row";
  const iconLabel = document.createElement("span");
  iconLabel.className = "ws-settings-label";
  iconLabel.textContent = "アイコン";
  iconRow.appendChild(iconLabel);
  const iconBtn = document.createElement("button");
  iconBtn.type = "button";
  iconBtn.className = "icon-select-btn";
  iconBtn.innerHTML = '<span class="icon-select-preview">' +
    renderIcon(ws.icon || "mdi-console", ws.icon_color, 18) +
    '<span class="icon-select-label">' + escapeHtml(ws.icon || "デフォルト") + '</span></span>';
  iconBtn.addEventListener("click", () => {
    if (setTitleFn) {
      const closePicker = openWsIconPickerInline(container, ws, goBackToSettings);
      setTitleFn("アイコン選択", () => {
        closePicker();
        goBackToSettings();
      });
    } else {
      openWsIconPicker(ws, goBackToSettings);
    }
  });
  iconRow.appendChild(iconBtn);
  body.appendChild(iconRow);

  const jobSection = document.createElement("div");
  jobSection.className = "ws-settings-section";
  const jobHeader = document.createElement("div");
  jobHeader.className = "ws-settings-section-header";
  const jobTitle = document.createElement("span");
  jobTitle.textContent = "ジョブ";
  jobHeader.appendChild(jobTitle);
  const jobAddBtn = document.createElement("button");
  jobAddBtn.type = "button";
  jobAddBtn.className = "ws-add-item-btn";
  jobAddBtn.innerHTML = '<i class="mdi mdi-plus"></i>';
  jobAddBtn.addEventListener("click", () => {
    if (setTitleFn) setTitleFn("ジョブ追加", goBackToSettings);
    renderInlineJobCreate(container, ws.name, goBackToSettings, setTitleFn);
  });
  jobHeader.appendChild(jobAddBtn);
  jobSection.appendChild(jobHeader);
  const jobList = document.createElement("div");
  jobList.className = "ws-settings-item-list";
  jobSection.appendChild(jobList);
  body.appendChild(jobSection);

  const linkSection = document.createElement("div");
  linkSection.className = "ws-settings-section";
  const linkHeader = document.createElement("div");
  linkHeader.className = "ws-settings-section-header";
  const linkTitle = document.createElement("span");
  linkTitle.textContent = "リンク";
  linkHeader.appendChild(linkTitle);
  const linkAddBtn = document.createElement("button");
  linkAddBtn.type = "button";
  linkAddBtn.className = "ws-add-item-btn";
  linkAddBtn.innerHTML = '<i class="mdi mdi-plus"></i>';
  linkAddBtn.addEventListener("click", () => {
    if (setTitleFn) setTitleFn("リンク追加", goBackToSettings);
    renderInlineLinkCreate(container, ws.name, goBackToSettings, setTitleFn);
  });
  linkHeader.appendChild(linkAddBtn);
  linkSection.appendChild(linkHeader);
  const linkList = document.createElement("div");
  linkList.className = "ws-settings-item-list";
  linkSection.appendChild(linkList);
  body.appendChild(linkSection);

  loadWsSettingsItems(jobList, linkList, container, ws, onBack, setTitleFn);
}

async function loadWsSettingsItems(jobList, linkList, container, ws, onBack, setTitleFn) {
  let jobs = {};
  let links = [];
  try {
    const [jobsRes, linksRes] = await Promise.all([
      apiFetch(workspaceApiPath(ws.name, "/jobs")),
      apiFetch(workspaceApiPath(ws.name, "/links")),
    ]);
    if (jobsRes && jobsRes.ok) jobs = await jobsRes.json();
    if (linksRes && linksRes.ok) links = await linksRes.json();
  } catch (e) {
    console.error("loadWsSettingsItems failed:", e);
  }

  const goBackToSettings = () => renderWsSettingsPane(container, ws, onBack, setTitleFn);

  const jobEntries = Object.entries(jobs).filter(([name]) => name !== "terminal");
  if (jobEntries.length === 0) {
    jobList.innerHTML = '<div class="ws-settings-empty">ジョブなし</div>';
  } else {
    for (const [name, job] of jobEntries) {
      const row = document.createElement("div");
      row.className = "ws-settings-item";
      row.innerHTML = renderIcon(job.icon || "mdi-play", job.icon_color, 16) +
        '<span class="ws-settings-item-name">' + escapeHtml(job.label || name) + '</span>';
      row.addEventListener("click", () => {
        if (setTitleFn) setTitleFn("ジョブ編集", goBackToSettings);
        renderInlineJobEdit(container, {
          workspace: ws.name, name,
          label: job.label || name,
          icon: job.icon, iconColor: job.icon_color,
          command: job.command || "",
          confirm: job.confirm, terminal: job.terminal,
        }, goBackToSettings, setTitleFn);
      });
      jobList.appendChild(row);
    }
  }

  if (links.length === 0) {
    linkList.innerHTML = '<div class="ws-settings-empty">リンクなし</div>';
  } else {
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const row = document.createElement("div");
      row.className = "ws-settings-item";
      row.innerHTML = renderIcon(link.icon || "mdi-web", link.icon_color, 16) +
        '<span class="ws-settings-item-name">' + escapeHtml(link.label || link.url) + '</span>';
      row.addEventListener("click", () => {
        if (setTitleFn) setTitleFn("リンク編集", goBackToSettings);
        renderInlineLinkEdit(container, {
          workspace: ws.name, index: i,
          label: link.label || link.url,
          url: link.url,
          icon: link.icon, iconColor: link.icon_color,
        }, goBackToSettings, setTitleFn);
      });
      linkList.appendChild(row);
    }
  }
}

const SERVER_INFO_LABELS = {
  hostname: "ホスト名",
  ip: "IPアドレス",
  os: "OS",
  uptime: "稼働時間",
  cpu_temp: "CPU温度",
  memory: "メモリ",
  disk: "ディスク",
};

async function renderServerInfoTo(container) {
  container.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>';
  try {
    const res = await apiFetch("/system/info");
    if (!res || !res.ok) {
      container.innerHTML = '<div style="color:var(--error);padding:16px">取得に失敗しました</div>';
      return;
    }
    const data = await res.json();
    container.innerHTML = "";
    for (const [key, label] of Object.entries(SERVER_INFO_LABELS)) {
      if (!(key in data)) continue;
      const row = document.createElement("div");
      row.className = "server-info-row";
      row.innerHTML = `<span class="server-info-label">${escapeHtml(label)}</span><span class="server-info-value">${escapeHtml(String(data[key]))}</span>`;
      container.appendChild(row);
    }
  } catch (e) {
    container.innerHTML = `<div style="color:var(--error);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

async function openSettingsServerInfo() {
  $("settings-title").textContent = "サーバー情報";
  showSettingsView("settings-server-info-view");
  $("settings-modal").style.display = "flex";
  await renderServerInfoTo($("server-info-list"));
}

async function renderProcessListTo(container) {
  container.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>';
  try {
    const res = await apiFetch("/system/processes");
    if (!res || !res.ok) {
      container.innerHTML = '<div style="color:var(--error);padding:16px">取得に失敗しました</div>';
      return;
    }
    const data = await res.json();
    container.innerHTML = "";
    for (const proc of data) {
      const row = document.createElement("div");
      row.className = "server-info-row process-row";
      row.innerHTML =
        `<span class="process-name">${escapeHtml(proc.name)}</span>` +
        `<span class="process-stats">` +
        `<span class="process-cpu">${proc.cpu.toFixed(1)}%</span>` +
        `<span class="process-mem">${proc.mem.toFixed(1)}%</span>` +
        `</span>`;
      row.title = `PID: ${proc.pid}\n${proc.command}`;
      container.appendChild(row);
    }
  } catch (e) {
    container.innerHTML = `<div style="color:var(--error);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

async function openProcessList() {
  $("settings-title").textContent = "プロセス一覧";
  showSettingsView("settings-process-list-view");
  $("settings-modal").style.display = "flex";
  await renderProcessListTo($("process-list"));
}

async function renderOpLogTo(container) {
  container.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">読み込み中...</div>';
  try {
    const res = await apiFetch("/logs");
    if (!res || !res.ok) {
      container.innerHTML = '<div style="color:var(--error);padding:16px">取得に失敗しました</div>';
      return;
    }
    const entries = await res.json();
    container.innerHTML = "";
    if (entries.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center">ログなし</div>';
      return;
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const row = document.createElement("div");
      row.className = "op-log-row";
      const ts = e.ts ? new Date(e.ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
      const status = e.status_code ? ` ${e.status_code}` : "";
      const duration = e.duration_ms ? ` ${e.duration_ms}ms` : "";
      const detail = e.detail ? ` ${e.detail}` : "";
      row.innerHTML =
        `<span class="op-log-ts">${escapeHtml(ts)}</span>` +
        `<span class="op-log-method">${escapeHtml(e.method || "")}</span>` +
        `<span class="op-log-path">${escapeHtml(e.path || "")}${escapeHtml(status)}${escapeHtml(duration)}${escapeHtml(detail)}</span>`;
      container.appendChild(row);
    }
  } catch (e) {
    container.innerHTML = `<div style="color:var(--error);padding:16px">${escapeHtml(e.message)}</div>`;
  }
}

async function openOpLog() {
  $("settings-title").textContent = "操作ログ";
  showSettingsView("settings-op-log-view");
  $("settings-modal").style.display = "flex";
  await renderOpLogTo($("op-log-list"));
}


async function saveWsIcon(ws, icon, color) {
  try {
    const res = await apiFetch(workspaceApiPath(ws.name, "/config"), {
      method: "PUT",
      body: { icon, icon_color: color },
    });
    if (!res) return false;
    if (!res.ok) {
      const data = await res.json();
      showToast(data.detail || "保存に失敗しました");
      return false;
    }
    ws.icon = icon;
    ws.icon_color = color;
    showToast("アイコンを更新しました", "success");
    return true;
  } catch (e) {
    showToast(e.message);
    return false;
  }
}

function openWsIconPicker(ws, refreshFn) {
  openIconPicker(async (icon, color) => {
    if (await saveWsIcon(ws, icon, color)) {
      refreshFn ? refreshFn() : openSettingsWsVisibility();
    }
  }, ws.icon, ws.icon_color);
}

function openWsIconPickerInline(container, ws, refreshFn) {
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  container.appendChild(wrapper);
  return renderInlineIconPicker(wrapper, async (icon, color) => {
    await saveWsIcon(ws, icon, color);
    refreshFn();
  }, ws.icon, ws.icon_color, true);
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

async function openCloneModal(defaultTab = "github") {
  $("clone-url").value = "";
  $("clone-name").value = "";
  hideFormError("clone-error");
  $("clone-output").style.display = "none";
  $("clone-output").textContent = "";
  $("clone-submit").disabled = false;
  selectedCloneUrl = "";
  switchCloneTab(defaultTab);
  $("clone-modal").style.display = "flex";
  if (defaultTab === "github") await loadGithubRepos();
}

function closeCloneModal() {
  $("clone-modal").style.display = "none";
}

function switchCloneTab(tab) {
  cloneTab = tab;
  for (const btn of document.querySelectorAll("#clone-modal .clone-tab")) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  $("clone-tab-github").style.display = tab === "github" ? "block" : "none";
  $("clone-tab-url").style.display = tab === "url" ? "block" : "none";
  $("clone-tab-visibility").style.display = tab === "visibility" ? "block" : "none";
  const cloneFields = $("clone-modal-clone-fields");
  if (cloneFields) cloneFields.style.display = tab === "visibility" ? "none" : "";
  if (tab === "url") $("clone-url").focus();
  if (tab === "visibility") renderWsVisibilityChecklistTo($("clone-visibility-list"));
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
  if (!confirm("設定をエクスポートしますか？")) return;
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
