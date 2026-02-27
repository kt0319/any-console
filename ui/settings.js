function applyPanelBottom() {
  document.querySelector(".main-panel").classList.toggle("panel-bottom", panelBottom);
}

function showSettingsView(viewId) {
  for (const id of ["settings-menu-view", "settings-server-info-view", "settings-process-list-view", "settings-op-log-view"]) {
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

function createWorkspaceItemElements(ws) {
  const iconSpan = document.createElement("span");
  iconSpan.className = "ws-icon-display";
  iconSpan.innerHTML = ws.icon ? renderIcon(ws.icon, ws.icon_color, 18) : '<span class="mdi mdi-console" style="color:var(--text-muted)"></span>';
  const label = document.createElement("span");
  label.className = "ws-check-label";
  label.textContent = ws.name;
  return { iconSpan, label };
}

function renderWorkspaceVisibilityChecklistTo(container) {
  container.innerHTML = "";
  for (const ws of allWorkspaces) {
    const item = document.createElement("div");
    item.className = "ws-check-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !ws.hidden;
    checkbox.dataset.ws = ws.name;
    checkbox.addEventListener("change", (e) => toggleWorkspace(ws.name, e.target.checked));
    const { iconSpan, label } = createWorkspaceItemElements(ws);
    item.append(checkbox, iconSpan, label);
    container.appendChild(item);
  }
}

function createWorkspaceSettingsSection(body, title, onAdd) {
  const section = document.createElement("div");
  section.className = "ws-settings-section";
  const header = document.createElement("div");
  header.className = "ws-settings-section-header";
  const titleEl = document.createElement("span");
  titleEl.textContent = title;
  header.appendChild(titleEl);
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "ws-add-item-btn";
  addBtn.innerHTML = '<i class="mdi mdi-plus"></i>';
  addBtn.addEventListener("click", onAdd);
  header.appendChild(addBtn);
  section.appendChild(header);
  const list = document.createElement("div");
  list.className = "ws-settings-item-list";
  section.appendChild(list);
  body.appendChild(section);
  return list;
}

function createWorkspaceSettingsItemRow({
  icon,
  iconColor,
  defaultIcon,
  label,
  onClick,
}) {
  const row = document.createElement("div");
  row.className = "ws-settings-item";
  row.innerHTML = renderIcon(icon || defaultIcon, iconColor, 16) +
    '<span class="ws-settings-item-name">' + escapeHtml(label) + "</span>";
  row.addEventListener("click", onClick);
  return row;
}

function renderWorkspaceSettingsList(listEl, items, emptyText, renderItem) {
  if (items.length === 0) {
    listEl.innerHTML = `<div class="ws-settings-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  for (const item of items) {
    listEl.appendChild(renderItem(item));
  }
}

function toJobEditData(workspaceName, name, job) {
  return {
    workspace: workspaceName,
    name,
    label: job.label || name,
    icon: job.icon,
    iconColor: job.icon_color,
    command: job.command || "",
    confirm: job.confirm,
    terminal: job.terminal,
  };
}

function toLinkEditData(workspaceName, index, link) {
  return {
    workspace: workspaceName,
    index,
    label: link.label || link.url,
    url: link.url,
    icon: link.icon,
    iconColor: link.icon_color,
  };
}

function createWorkspaceIconRow(container, ws, setTitleFn, goBackToSettings) {
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
      const closePicker = openWorkspaceIconPickerInline(container, ws, goBackToSettings);
      setTitleFn("アイコン選択", () => {
        closePicker();
        goBackToSettings();
      });
      return;
    }
    openWorkspaceIconPicker(ws, goBackToSettings);
  });
  iconRow.appendChild(iconBtn);
  return iconRow;
}

function renderWorkspaceSettingsPane(container, ws, onBack, setTitleFn) {
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

  const goBackToSettings = () => renderWorkspaceSettingsPane(container, ws, onBack, setTitleFn);
  body.appendChild(createWorkspaceIconRow(container, ws, setTitleFn, goBackToSettings));

  const jobList = createWorkspaceSettingsSection(body, "ジョブ", () => {
    if (setTitleFn) setTitleFn("ジョブ追加", goBackToSettings);
    renderInlineJobCreate(container, ws.name, goBackToSettings, setTitleFn);
  });

  const linkList = createWorkspaceSettingsSection(body, "リンク", () => {
    if (setTitleFn) setTitleFn("リンク追加", goBackToSettings);
    renderInlineLinkCreate(container, ws.name, goBackToSettings, setTitleFn);
  });

  loadWorkspaceSettingsItems({ jobList, linkList }, container, ws, onBack, setTitleFn);
}

async function loadWorkspaceSettingsItems(lists, container, ws, onBack, setTitleFn) {
  const { jobs, links } = await fetchWorkspaceJobsAndLinks(ws.name);
  const { jobList, linkList } = lists;

  const goBackToSettings = () => renderWorkspaceSettingsPane(container, ws, onBack, setTitleFn);

  const jobEntries = Object.entries(jobs)
    .filter(([name]) => name !== "terminal")
    .map(([name, job]) => ({ name, job }));
  renderWorkspaceSettingsList(jobList, jobEntries, "ジョブなし", ({ name, job }) => {
    return createWorkspaceSettingsItemRow({
      icon: job.icon,
      iconColor: job.icon_color,
      defaultIcon: "mdi-play",
      label: job.label || name,
      onClick: () => {
        if (setTitleFn) setTitleFn("ジョブ編集", goBackToSettings);
        renderInlineJobEdit(
          container,
          toJobEditData(ws.name, name, job),
          goBackToSettings,
          setTitleFn,
        );
      },
    });
  });

  const linkEntries = links.map((link, index) => ({ link, index }));
  renderWorkspaceSettingsList(linkList, linkEntries, "リンクなし", ({ link, index }) => {
    return createWorkspaceSettingsItemRow({
      icon: link.icon,
      iconColor: link.icon_color,
      defaultIcon: "mdi-web",
      label: link.label || link.url,
      onClick: () => {
        if (setTitleFn) setTitleFn("リンク編集", goBackToSettings);
        renderInlineLinkEdit(
          container,
          toLinkEditData(ws.name, index, link),
          goBackToSettings,
          setTitleFn,
        );
      },
    });
  });
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

function renderServerInfoRows(container, data) {
  for (const [key, label] of Object.entries(SERVER_INFO_LABELS)) {
    if (!(key in data)) continue;
    const row = document.createElement("div");
    row.className = "server-info-row";
    row.innerHTML = `<span class="server-info-label">${escapeHtml(label)}</span><span class="server-info-value">${escapeHtml(String(data[key]))}</span>`;
    container.appendChild(row);
  }
}

function renderProcessRows(container, processes) {
  for (const proc of processes) {
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
}

function renderOpLogRows(container, entries) {
  if (entries.length === 0) {
    setInlineStatus(container, "ログなし");
    return;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const row = document.createElement("div");
    row.className = "op-log-row";
    const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    const status = entry.status_code ? ` ${entry.status_code}` : "";
    const duration = entry.duration_ms ? ` ${entry.duration_ms}ms` : "";
    const detail = entry.detail ? ` ${entry.detail}` : "";
    row.innerHTML =
      `<span class="op-log-ts">${escapeHtml(ts)}</span>` +
      `<span class="op-log-method">${escapeHtml(entry.method || "")}</span>` +
      `<span class="op-log-path">${escapeHtml(entry.path || "")}${escapeHtml(status)}${escapeHtml(duration)}${escapeHtml(detail)}</span>`;
    container.appendChild(row);
  }
}

async function renderServerInfoTo(container) {
  await fetchAndRenderWithStatus(container, "/system/info", (data) => renderServerInfoRows(container, data));
}

async function renderProcessListTo(container) {
  await fetchAndRenderWithStatus(container, "/system/processes", (data) => renderProcessRows(container, data));
}

async function renderOpLogTo(container) {
  await fetchAndRenderWithStatus(container, "/logs", (entries) => renderOpLogRows(container, entries));
}

async function openSettingsDataView({
  title,
  viewId,
  listId,
  renderFn,
}) {
  $("settings-title").textContent = title;
  showSettingsView(viewId);
  $("settings-modal").style.display = "flex";
  await renderFn($(listId));
}

async function openSettingsServerInfo() {
  await openSettingsDataView({
    title: "サーバー情報",
    viewId: "settings-server-info-view",
    listId: "server-info-list",
    renderFn: renderServerInfoTo,
  });
}

async function openProcessList() {
  await openSettingsDataView({
    title: "プロセス一覧",
    viewId: "settings-process-list-view",
    listId: "process-list",
    renderFn: renderProcessListTo,
  });
}

async function openOpLog() {
  await openSettingsDataView({
    title: "操作ログ",
    viewId: "settings-op-log-view",
    listId: "op-log-list",
    renderFn: renderOpLogTo,
  });
}


async function saveWorkspaceIcon(ws, icon, color) {
  const result = await putWorkspaceConfig(ws.name, { icon, icon_color: color });
  if (!result.ok) {
    if (result.error) {
      showToast(result.error.message);
    } else {
      showToast((result.data && result.data.detail) || "保存に失敗しました");
    }
    return false;
  }
  ws.icon = icon;
  ws.icon_color = color;
  showToast("アイコンを更新しました", "success");
  return true;
}

function openWorkspaceIconPicker(ws, refreshFn) {
  openIconPicker(async (icon, color) => {
    if (await saveWorkspaceIcon(ws, icon, color)) {
      if (refreshFn) refreshFn();
    }
  }, ws.icon, ws.icon_color);
}

function openWorkspaceIconPickerInline(container, ws, refreshFn) {
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  container.appendChild(wrapper);
  return renderInlineIconPicker(wrapper, async (icon, color) => {
    await saveWorkspaceIcon(ws, icon, color);
    refreshFn();
  }, ws.icon, ws.icon_color, true);
}

async function toggleWorkspace(name, visible) {
  const ws = allWorkspaces.find((w) => w.name === name);
  if (!ws) return;
  const hidden = !visible;
  const result = await putWorkspaceConfig(name, {
    icon: ws.icon || "",
    icon_color: ws.icon_color || "",
    hidden,
  });
  if (!result.ok) {
    if (result.error) {
      showToast(result.error.message, "error");
    } else {
      showToast((result.data && result.data.detail) || "設定の保存に失敗しました", "error");
    }
    return;
  }
  ws.hidden = hidden;
  let selectionCleared = false;
  if (!visible && selectedWorkspace === name) {
    selectedWorkspace = null;
    selectionCleared = true;
  }
  if (selectionCleared) {
    refreshWorkspaceHeader();
    loadJobsForWorkspace();
    updateGitBarVisibility();
  }
}

async function restoreAllWorkspaceVisibility() {
  const hiddenTargets = allWorkspaces.filter((ws) => ws.hidden);
  if (hiddenTargets.length === 0) return { restored: 0, failed: 0 };

  let restored = 0;
  let failed = 0;
  for (const ws of hiddenTargets) {
    const result = await putWorkspaceConfig(ws.name, {
      icon: ws.icon || "",
      icon_color: ws.icon_color || "",
      hidden: false,
    });
    if (result.ok) {
      ws.hidden = false;
      restored += 1;
    } else {
      failed += 1;
    }
  }

  return { restored, failed };
}

function toSshUrl(url) {
  const m = url.match(/^https?:\/\/github\.com\/(.+)/);
  if (!m) return url;
  const path = m[1].replace(/\/$/, "");
  return `git@github.com:${path}.git`;
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
      invalidateWorkspaceMetaCache();
      invalidateGithubReposCache();
      closeSettings();
      await loadWorkspaces();
    } catch (e) {
      showToast(e.message, "error");
    }
  };
  input.click();
}
