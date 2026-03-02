function createWorkspaceItemElements(ws) {
  const iconSpan = document.createElement("span");
  iconSpan.className = "ws-icon-display";
  iconSpan.innerHTML = ws.icon ? renderIcon(ws.icon, ws.icon_color, 18) : '<span class="mdi mdi-console" style="color:var(--text-muted)"></span>';
  const label = document.createElement("span");
  label.className = "ws-check-label";
  label.textContent = ws.name;
  return { iconSpan, label };
}

async function reorderWorkspaces(orderedNames) {
  try {
    const res = await apiFetch("/workspace-order", {
      method: "PUT",
      body: { order: orderedNames },
    });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || "並び替えに失敗しました", "error");
      return false;
    }
    showToast("ワークスペース順を更新しました", "success");
    return true;
  } catch (e) {
    showToast(`並び替えエラー: ${e.message}`, "error");
    return false;
  }
}

function renderWorkspaceVisibilityChecklistTo(container) {
  container.innerHTML = "";
  let orderSaving = false;
  let orderSnapshot = null;

  for (const ws of allWorkspaces) {
    const item = document.createElement("div");
    item.className = "ws-check-item";
    item.dataset.wsName = ws.name;

    const handle = document.createElement("span");
    handle.className = "ws-check-drag-handle";
    handle.innerHTML = '<span class="mdi mdi-drag"></span>';

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !ws.hidden;
    checkbox.dataset.ws = ws.name;
    checkbox.addEventListener("change", (e) => toggleWorkspace(ws.name, e.target.checked));

    const { iconSpan, label } = createWorkspaceItemElements(ws);
    item.append(handle, checkbox, iconSpan, label);
    container.appendChild(item);

    bindVerticalDragHandle({
      handle,
      row: item,
      list: container,
      rowSelector: ".ws-check-item",
      canStart: () => !orderSaving,
      onStart: () => {
        orderSnapshot = allWorkspaces.slice();
      },
      onReorder: (fromIdx, toIdx) => {
        if (fromIdx === toIdx) return;
        const [moved] = allWorkspaces.splice(fromIdx, 1);
        if (moved) allWorkspaces.splice(toIdx, 0, moved);
      },
      onCommit: async (didMove) => {
        if (!didMove) return;
        orderSaving = true;
        const ok = await reorderWorkspaces(allWorkspaces.map((w) => w.name));
        if (!ok && orderSnapshot) {
          allWorkspaces.splice(0, allWorkspaces.length, ...orderSnapshot);
        }
        orderSaving = false;
      },
    });
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

  loadWorkspaceSettingsItems({ jobList }, container, ws, onBack, setTitleFn);
}

async function loadWorkspaceSettingsItems(lists, container, ws, onBack, setTitleFn) {
  const { jobs } = await fetchWorkspaceJobsAndLinks(ws.name);
  const { jobList } = lists;

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
