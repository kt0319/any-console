function applyPanelBottom() {
  document.querySelector(".main-panel").classList.toggle("panel-bottom", panelBottom);
}

function showSettingsView(viewId) {
  for (const id of ["settings-menu-view", "settings-terminal-view", "settings-server-info-view", "settings-process-list-view", "settings-op-log-view"]) {
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

function applyAllTerminalSettingsToTabs() {
  let needsRefit = false;
  for (const [key, schema] of Object.entries(TERMINAL_SETTINGS_SCHEMA)) {
    if (schema.requiresRefit) needsRefit = true;
    for (const tab of openTabs) {
      if (tab.type !== "terminal" || !tab.term) continue;
      tab.term.options[key] = terminalSettings[key];
    }
  }
  requestAnimationFrame(() => {
    if (needsRefit && splitMode) {
      rebuildSplitLayout();
      return;
    }
    if (needsRefit) {
      const activeTerminal = openTabs.find((t) => t.id === activeTabId && t.type === "terminal");
      if (activeTerminal) refitTerminalWithFocus(activeTerminal);
    }
  });
}

function applyTerminalSettingToTabs(key, value) {
  const next = setTerminalSetting(key, value);
  if (next == null) return null;
  const schema = TERMINAL_SETTINGS_SCHEMA[key];
  for (const tab of openTabs) {
    if (tab.type !== "terminal" || !tab.term) continue;
    tab.term.options[key] = next;
  }
  requestAnimationFrame(() => {
    if (schema?.requiresRefit && splitMode) {
      rebuildSplitLayout();
      return;
    }
    if (schema?.requiresRefit) {
      const activeTerminal = openTabs.find((t) => t.id === activeTabId && t.type === "terminal");
      if (activeTerminal) {
        refitTerminalWithFocus(activeTerminal);
      }
    }
  });
  return next;
}

function createTerminalNumberSettingRow(key, schema) {
  const row = document.createElement("div");
  row.className = "terminal-settings-item";

  const header = document.createElement("div");
  header.className = "terminal-settings-item-header";
  header.innerHTML = `<span class="terminal-settings-item-label">${escapeHtml(schema.label)}</span>`;
  row.appendChild(header);

  const controlRow = document.createElement("div");
  controlRow.className = "terminal-settings-control-row";

  const minusBtn = document.createElement("button");
  minusBtn.type = "button";
  minusBtn.className = "terminal-font-size-step-btn";
  minusBtn.textContent = "-";
  controlRow.appendChild(minusBtn);

  const number = document.createElement("input");
  number.type = "number";
  number.id = `terminal-setting-${key}`;
  number.className = "form-input terminal-font-size-input";
  number.min = String(schema.min);
  number.max = String(schema.max);
  number.step = String(schema.step || 1);
  number.value = String(terminalSettings[key]);
  number.inputMode = "numeric";
  controlRow.appendChild(number);

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "terminal-font-size-step-btn";
  plusBtn.textContent = "+";
  controlRow.appendChild(plusBtn);

  row.appendChild(controlRow);

  const value = document.createElement("div");
  value.className = "terminal-settings-value";
  row.appendChild(value);

  if (schema.note) {
    const note = document.createElement("div");
    note.className = "terminal-settings-note";
    note.textContent = schema.note;
    row.appendChild(note);
  }

  const sync = (settingValue) => {
    const clamped = sanitizeTerminalSetting(key, settingValue);
    value.textContent = schema.unit ? `${clamped}${schema.unit}` : String(clamped);
    number.value = String(clamped);
    minusBtn.disabled = clamped <= schema.min;
    plusBtn.disabled = clamped >= schema.max;
  };

  const commit = (rawValue) => {
    const next = applyTerminalSettingToTabs(key, rawValue);
    if (next != null) sync(next);
  };

  minusBtn.addEventListener("click", () => commit(terminalSettings[key] - (schema.step || 1)));
  plusBtn.addEventListener("click", () => commit(terminalSettings[key] + (schema.step || 1)));
  number.addEventListener("change", () => commit(number.value));
  number.addEventListener("blur", () => sync(number.value || terminalSettings[key]));

  sync(terminalSettings[key]);
  return row;
}

function createTerminalBooleanSettingRow(key, schema) {
  const row = document.createElement("label");
  row.className = "terminal-settings-item terminal-settings-toggle";

  const text = document.createElement("div");
  text.className = "terminal-settings-toggle-copy";
  text.innerHTML =
    `<span class="terminal-settings-item-label">${escapeHtml(schema.label)}</span>` +
    (schema.note ? `<span class="terminal-settings-note">${escapeHtml(schema.note)}</span>` : "");
  row.appendChild(text);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !!terminalSettings[key];
  checkbox.addEventListener("change", () => {
    checkbox.checked = !!applyTerminalSettingToTabs(key, checkbox.checked);
  });
  row.appendChild(checkbox);

  return row;
}

function renderTerminalSettingsPane(container) {
  container.innerHTML = "";

  const section = document.createElement("div");
  section.className = "terminal-settings-view";
  for (const [key, schema] of Object.entries(TERMINAL_SETTINGS_SCHEMA)) {
    if (schema.type === "number") {
      section.appendChild(createTerminalNumberSettingRow(key, schema));
      continue;
    }
    if (schema.type === "boolean") {
      section.appendChild(createTerminalBooleanSettingRow(key, schema));
    }
  }

  const actions = document.createElement("div");
  actions.className = "terminal-settings-actions";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "terminal-settings-reset-btn";
  resetBtn.textContent = "初期値に戻す";
  resetBtn.addEventListener("click", () => {
    resetTerminalSettings();
    applyAllTerminalSettingsToTabs();
    renderTerminalSettingsPane(container);
  });
  actions.appendChild(resetBtn);
  section.appendChild(actions);
  container.appendChild(section);
}

function openTerminalSettings() {
  $("settings-title").textContent = "ターミナル";
  showSettingsView("settings-terminal-view");
  renderTerminalSettingsPane($("settings-terminal-body"));
  $("settings-modal").style.display = "flex";
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
  actions = [],
  leadingControl = null,
  className = "",
}) {
  const row = document.createElement("div");
  row.className = `ws-settings-item${className ? ` ${className}` : ""}`;
  if (leadingControl) row.appendChild(leadingControl);

  const iconEl = document.createElement("span");
  iconEl.className = "ws-settings-item-icon";
  iconEl.innerHTML = renderIcon(icon || defaultIcon, iconColor, 16);
  row.appendChild(iconEl);

  const labelEl = document.createElement("span");
  labelEl.className = "ws-settings-item-name";
  labelEl.textContent = label;
  row.appendChild(labelEl);

  if (actions.length > 0) {
    const actionWrap = document.createElement("div");
    actionWrap.className = "ws-settings-item-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-settings-item-action-btn";
      btn.innerHTML = action.iconHtml;
      btn.title = action.title || "";
      if (action.disabled) btn.disabled = true;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action.onClick();
      });
      actionWrap.appendChild(btn);
    }
    row.appendChild(actionWrap);
  }
  row.addEventListener("click", onClick);
  return row;
}

function renderWorkspaceSettingsList(listEl, items, emptyText, renderItem) {
  listEl.innerHTML = "";
  if (items.length === 0) {
    listEl.innerHTML = `<div class="ws-settings-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  items.forEach((item, index) => {
    listEl.appendChild(renderItem(item, index));
  });
}

function moveWorkspaceSettingsListRow(list, rowSelector, fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const rows = Array.from(list.querySelectorAll(rowSelector));
  const row = rows[fromIdx];
  const target = rows[toIdx];
  if (!row || !target) return;
  if (toIdx > fromIdx) {
    list.insertBefore(row, target.nextSibling);
    return;
  }
  list.insertBefore(row, target);
}

function bindVerticalDragHandle({
  handle,
  row,
  list,
  rowSelector,
  canStart,
  onStart,
  onReorder,
  onCommit,
}) {
  let dragState = null;

  function cleanup(onMove, onEnd) {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onEnd);
  }

  function onPointerStart(e) {
    if (canStart && !canStart()) return;
    e.preventDefault();
    e.stopPropagation();

    const rows = Array.from(list.querySelectorAll(rowSelector));
    if (rows.length < 2) return;

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rowRect = row.getBoundingClientRect();
    dragState = {
      idx: rows.indexOf(row),
      startY: clientY,
      rowHeight: rowRect.height || 1,
      didMove: false,
    };
    if (dragState.idx < 0) {
      dragState = null;
      return;
    }

    if (onStart) onStart();
    row.classList.add("dragging");

    function onMove(ev) {
      if (!dragState) return;
      if (ev.cancelable) ev.preventDefault();
      const currentY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      row.style.transform = `translateY(${currentY - dragState.startY}px)`;

      const currentRows = Array.from(list.querySelectorAll(rowSelector));
      const listRect = list.getBoundingClientRect();
      let targetIdx = Math.floor((currentY - listRect.top) / dragState.rowHeight);
      targetIdx = Math.max(0, Math.min(targetIdx, currentRows.length - 1));
      if (targetIdx === dragState.idx) return;

      moveWorkspaceSettingsListRow(list, rowSelector, dragState.idx, targetIdx);
      if (onReorder) onReorder(dragState.idx, targetIdx);
      dragState.idx = targetIdx;
      dragState.startY = currentY;
      dragState.didMove = true;
      row.style.transform = "";
    }

    function onEnd() {
      if (!dragState) return;
      const didMove = dragState.didMove;
      dragState = null;
      row.classList.remove("dragging");
      row.style.transform = "";
      cleanup(onMove, onEnd);
      Promise.resolve(onCommit ? onCommit(didMove) : null).catch((err) => {
        console.error("drag commit failed:", err);
      });
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
  }

  handle.addEventListener("mousedown", onPointerStart);
  handle.addEventListener("touchstart", onPointerStart, { passive: false });
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

async function fetchWorkspaceJobDetailForSettings(workspaceName, jobName) {
  try {
    const res = await apiFetch(workspaceApiPath(workspaceName, `/jobs/${encodeURIComponent(jobName)}`));
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("fetchWorkspaceJobDetailForSettings failed:", e);
    return null;
  }
}

async function reorderWorkspaceJobs(workspaceName, orderedNames) {
  try {
    const res = await apiFetch(workspaceApiPath(workspaceName, "/job-order"), {
      method: "PUT",
      body: { order: orderedNames },
    });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || "ジョブの並び替えに失敗しました", "error");
      return false;
    }
    invalidateWorkspaceMetaCache(workspaceName);
    invalidateWorkspaceJobsCache(workspaceName);
    if (selectedWorkspace === workspaceName) {
      await loadJobsForWorkspace(true);
    }
    showToast("ジョブ順を更新しました", "success");
    return true;
  } catch (e) {
    showToast(`ジョブ順の更新エラー: ${e.message}`, "error");
    return false;
  }
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
  let jobOrderSaving = false;
  let jobOrderSnapshot = null;

  function moveJobEntry(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const [moved] = jobEntries.splice(fromIdx, 1);
    if (!moved) return;
    jobEntries.splice(toIdx, 0, moved);
  }

  function renderJobList() {
    renderWorkspaceSettingsList(jobList, jobEntries, "ジョブなし", ({ name, job }) => {
      const handle = document.createElement("span");
      handle.className = "ws-settings-item-drag-handle";
      handle.innerHTML = '<span class="mdi mdi-drag"></span>';

      const row = createWorkspaceSettingsItemRow({
        icon: job.icon,
        iconColor: job.icon_color,
        defaultIcon: "mdi-play",
        label: job.label || name,
        leadingControl: handle,
        className: "ws-settings-item-draggable",
        onClick: async () => {
          if (jobOrderSaving) return;
          const detailed = await fetchWorkspaceJobDetailForSettings(ws.name, name);
          const editJob = detailed ? { ...job, ...detailed } : job;
          if (setTitleFn) setTitleFn("ジョブ編集", goBackToSettings);
          renderInlineJobEdit(
            container,
            toJobEditData(ws.name, name, editJob),
            goBackToSettings,
            setTitleFn,
          );
        },
      });
      row.dataset.jobName = name;

      bindVerticalDragHandle({
        handle,
        row,
        list: jobList,
        rowSelector: ".ws-settings-item",
        canStart: () => !jobOrderSaving,
        onStart: () => {
          jobOrderSnapshot = jobEntries.slice();
        },
        onReorder: (fromIdx, toIdx) => {
          moveJobEntry(fromIdx, toIdx);
        },
        onCommit: async (didMove) => {
          if (!didMove) return;
          jobOrderSaving = true;
          const ok = await reorderWorkspaceJobs(ws.name, jobEntries.map((entry) => entry.name));
          if (!ok && jobOrderSnapshot) {
            jobEntries.splice(0, jobEntries.length, ...jobOrderSnapshot);
          }
          jobOrderSaving = false;
          renderJobList();
        },
      });

      return row;
    });
  }

  renderJobList();

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
