async function loadJobsForWorkspace() {
  if (!selectedWorkspace) {
    JOBS = {};
    selectedJob = null;
    $("output").innerHTML = '<div class="empty-state"></div>';
    return;
  }

  try {
    const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/jobs"));
    if (!res || !res.ok) {
      JOBS = {};
    } else {
      JOBS = await res.json();
    }
  } catch {
    JOBS = {};
  }

  selectedJob = null;
  renderTabBar();
}

function openJobConfirmModal(name) {
  const job = JOBS[name];
  if (!job) return;
  selectedJob = name;
  $("job-confirm-title").textContent = job.label || name;

  const argsContainer = $("job-confirm-args");
  argsContainer.innerHTML = "";
  if (job.args && job.args.length > 0) {
    for (const arg of job.args) {
      const group = document.createElement("div");
      group.className = "arg-group";
      const label = document.createElement("label");
      label.className = "arg-label";
      label.textContent = arg.name;
      if (arg.required) label.innerHTML += ' <span class="required">*</span>';
      group.appendChild(label);

      if (Array.isArray(arg.values) && arg.values.length > 0) {
        const radioGroup = document.createElement("div");
        radioGroup.className = "radio-group";
        for (const val of arg.values) {
          const lbl = document.createElement("label");
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `confirm-arg-${arg.name}`;
          radio.value = val;
          if (val === arg.values[0]) radio.checked = true;
          const span = document.createElement("span");
          span.className = "radio-btn";
          span.textContent = val;
          lbl.appendChild(radio);
          lbl.appendChild(span);
          radioGroup.appendChild(lbl);
        }
        group.appendChild(radioGroup);
      }
      argsContainer.appendChild(group);
    }
  } else {
    if (job.command) {
      const preview = escapeHtml(job.command.length > 300 ? job.command.slice(0, 300) + "..." : job.command);
      argsContainer.innerHTML = `<pre class="script-preview">${preview}</pre>`;
    }
  }

  $("job-confirm-modal").style.display = "flex";
}

function closeJobConfirmModal() {
  $("job-confirm-modal").style.display = "none";
}

function collectConfirmArgs() {
  const job = JOBS[selectedJob];
  if (!job || !job.args) return {};
  const args = {};
  for (const arg of job.args) {
    const checked = document.querySelector(`input[name="confirm-arg-${arg.name}"]:checked`);
    if (checked) args[arg.name] = checked.value;
  }
  return args;
}

function collectArgs() {
  const job = JOBS[selectedJob];
  if (!job || !job.args) return {};
  const args = {};
  for (const arg of job.args) {
    if (arg.required && Array.isArray(arg.values) && arg.values.length > 0) {
      args[arg.name] = arg.values[0];
    }
  }
  return args;
}

let _runJobQueue = Promise.resolve();

async function runJob(jobName = null, argsOverride = null, workspaceOverride = null) {
  const targetJob = jobName || selectedJob;
  if (!targetJob) return;
  if (selectedJob !== targetJob) {
    selectedJob = targetJob;
  }
  _runJobQueue = _runJobQueue.then(() => _runJobInner(targetJob, workspaceOverride));
}

async function _runJobInner(targetJob, workspaceOverride) {
  const workspace = workspaceOverride || selectedWorkspace;
  let job = JOBS[targetJob];
  if (!job && targetJob !== "terminal" && workspace) {
    try {
      const jobsRes = await apiFetch(workspaceApiPath(workspace, "/jobs"));
      if (jobsRes && jobsRes.ok) {
        const wsJobs = await jobsRes.json();
        job = wsJobs[targetJob];
      }
    } catch {}
  }
  job = job || {};
  const tabLabel = targetJob === "terminal" ? (workspaceOverride || workspace) : (job.label || targetJob);

  let initialCommand = null;
  let tabIcon = null;
  let wsIcon = null;
  const ws = allWorkspaces.find((w) => w.name === workspace);
  const wsIconObj = ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : { name: "mdi-console", color: "" };
  if (targetJob === "terminal") {
    tabIcon = wsIconObj;
  } else if (job.command) {
    initialCommand = job.command;
    tabIcon = { name: job.icon || "mdi-play", color: job.icon_color || "" };
    wsIcon = wsIconObj;
  }

  launchingTerminal = true;

  try {
    const res = await apiFetch("/run", {
      method: "POST",
      body: { job: "terminal", args: {}, workspace, icon: tabIcon?.name, icon_color: tabIcon?.color },
    });
    if (!res) return;

    const data = await res.json();
    if (data.status !== "ok" || !data.ws_url) {
      showToast(`${tabLabel} エラー: ターミナル作成に失敗`);
      return;
    }

    const jobName = targetJob !== "terminal" ? (job.label || targetJob) : null;
    addTerminalTab(data.ws_url, workspace, null, false, false, initialCommand, tabIcon, wsIcon, jobName);

  } catch (e) {
    showToast(`${tabLabel} エラー: ${e.message}`);
  } finally {
    launchingTerminal = false;
  }
}

function switchItemCreateType(type) {
  $("item-create-link-form").style.display = type === "link" ? "" : "none";
  $("item-create-job-form").style.display = type === "job" ? "" : "none";
  hideFormError("item-create-error");
  $("item-create-submit").textContent = type === "link" ? "追加" : "作成";
}

function getItemCreateType() {
  const checked = document.querySelector('input[name="item-create-type"]:checked');
  return checked ? checked.value : "link";
}

const ICON_COLOR_FIELDS = {
  linkCreate: { btnId: "link-create-icon-btn", defaultIcon: "mdi-web" },
  jobCreate: { btnId: "job-create-icon-btn", defaultIcon: "mdi-play" },
  linkEdit: { btnId: "link-edit-icon-btn", defaultIcon: "mdi-web" },
  jobEdit: { btnId: "job-edit-icon-btn", defaultIcon: "mdi-play" },
};
const iconColorState = {};
for (const key of Object.keys(ICON_COLOR_FIELDS)) {
  iconColorState[key] = { icon: "", color: "" };
}

function updateIconSelectPreview(key) {
  const f = ICON_COLOR_FIELDS[key];
  const s = iconColorState[key];
  const preview = $(f.btnId).querySelector(".icon-select-preview");
  if (!preview) return;
  if (!s.icon) {
    preview.innerHTML = '<span style="color:var(--text-muted)">アイコンを選択</span>';
    return;
  }
  const label = isImageDataIcon(s.icon) ? "favicon" : s.icon;
  preview.innerHTML = renderIcon(s.icon, s.color, 18) + `<span class="icon-select-label">${escapeHtml(label)}</span>`;
}

function initIconColorField(key, icon, color) {
  const f = ICON_COLOR_FIELDS[key];
  iconColorState[key] = { icon: icon || "", color: color || "" };
  updateIconSelectPreview(key);
}

function setupIconPickerBtn(key) {
  const f = ICON_COLOR_FIELDS[key];
  $(f.btnId).addEventListener("click", () => {
    openIconPicker((icon, color) => {
      iconColorState[key].icon = icon;
      iconColorState[key].color = color;
      updateIconSelectPreview(key);
    }, iconColorState[key].icon, iconColorState[key].color);
  });
}

function openItemCreateModal(workspace, type) {
  const modal = $("item-create-modal");
  modal.dataset.workspace = workspace || selectedWorkspace;
  $("link-create-url").value = "";
  $("job-create-name").value = "";
  $("job-create-script").value = "";
  $("job-create-confirm").checked = true;
  hideFormError("item-create-error");
  initIconColorField("linkCreate");
  initIconColorField("jobCreate");
  const radios = document.querySelectorAll('input[name="item-create-type"]');
  for (const r of radios) r.checked = r.value === type;
  switchItemCreateType(type);
  modal.style.display = "flex";
}

function openJobCreateModal() {
  openItemCreateModal(selectedWorkspace, "job");
}

function openLinkCreateModal(workspace) {
  openItemCreateModal(workspace, "link");
}

function closeItemCreateModal() {
  $("item-create-modal").style.display = "none";
}

function closeJobCreateModal() {
  closeItemCreateModal();
}

function closeLinkCreateModal() {
  closeItemCreateModal();
}

async function submitItemCreate() {
  const type = getItemCreateType();
  if (type === "link") {
    await submitLinkCreate();
  } else {
    await submitJobCreate();
  }
}

async function submitJobCreate() {
  const workspace = $("item-create-modal").dataset.workspace;
  const name = $("job-create-name").value.trim();
  const command = $("job-create-script").value;

  if (!name) {
    showFormError("item-create-error", "ジョブ名を入力してください");
    return;
  }
  if (!command.trim()) {
    showFormError("item-create-error", "コマンドを入力してください");
    return;
  }

  try {
    const res = await apiFetch(workspaceApiPath(workspace, "/jobs"), {
      method: "POST",
      body: { name, command, icon: iconColorState.jobCreate.icon, icon_color: iconColorState.jobCreate.color, confirm: $("job-create-confirm").checked },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) {
      showFormError("item-create-error", data.detail || "作成に失敗しました");
      return;
    }
    closeItemCreateModal();
    await loadJobsForWorkspace();
  } catch (e) {
    showFormError("item-create-error", e.message);
  }
}

async function submitLinkCreate() {
  const workspace = $("item-create-modal").dataset.workspace;
  const url = $("link-create-url").value.trim();

  if (!url) {
    showFormError("item-create-error", "URLを入力してください");
    return;
  }

  try {
    const res = await apiFetch(workspaceApiPath(workspace, "/links"), {
      method: "POST",
      body: { url, icon: iconColorState.linkCreate.icon, icon_color: iconColorState.linkCreate.color },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) {
      showFormError("item-create-error", data.detail || "追加に失敗しました");
      return;
    }
    closeItemCreateModal();
    showToast("リンクを追加しました", "success");
  } catch (e) {
    showFormError("item-create-error", e.message);
  }
}

function openItemEditModal(type, data, source) {
  const modal = $("item-edit-modal");
  modal.dataset.type = type;
  modal.dataset.workspace = data.workspace;
  modal.dataset.source = source || "picker";
  $("item-edit-title").textContent = type === "link" ? "リンク編集" : "ジョブ編集";
  hideFormError("item-edit-error");

  $("item-edit-link-form").style.display = type === "link" ? "" : "none";
  $("item-edit-job-form").style.display = type === "job" ? "" : "none";

  if (type === "link") {
    modal.dataset.index = data.index;
    $("link-edit-url").value = data.url || "";
    initIconColorField("linkEdit", data.icon, data.iconColor);
  } else {
    modal.dataset.jobName = data.name;
    $("job-edit-name").value = data.name;
    $("job-edit-script").value = data.command || "";
    $("job-edit-confirm").checked = data.confirm !== false;
    initIconColorField("jobEdit", data.icon, data.iconColor);
  }

  const deleteBtn = $("item-edit-delete");
  deleteBtn.onclick = async () => {
    if (type === "link") {
      await deleteLink(data.workspace, data.index, data.label);
    } else {
      await deleteJob(data.name, data.workspace);
    }
    closeItemEditModal();
    reopenAfterItemEdit(modal.dataset.source);
  };
  $("item-edit-save").onclick = () => submitItemEdit();
  $("item-edit-close").onclick = closeItemEditModal;
  modal.onclick = (e) => { if (e.target === modal) closeItemEditModal(); };
  modal.style.display = "flex";
}

async function submitItemEdit() {
  const modal = $("item-edit-modal");
  const type = modal.dataset.type;
  const workspace = modal.dataset.workspace;

  if (type === "link") {
    const url = $("link-edit-url").value.trim();
    if (!url) {
      showFormError("item-edit-error", "URLを入力してください");
      return;
    }
    const index = parseInt(modal.dataset.index, 10);
    try {
      const res = await apiFetch(workspaceApiPath(workspace, `/links/${index}`), {
        method: "PUT",
        body: { url, icon: iconColorState.linkEdit.icon, icon_color: iconColorState.linkEdit.color },
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) {
        showFormError("item-edit-error", data.detail || "保存に失敗しました");
        return;
      }
      closeItemEditModal();
      showToast("リンクを更新しました", "success");
      reopenAfterItemEdit(modal.dataset.source);
    } catch (e) {
      showFormError("item-edit-error", e.message);
    }
  } else {
    const command = $("job-edit-script").value;
    if (!command.trim()) {
      showFormError("item-edit-error", "コマンドを入力してください");
      return;
    }
    const jobName = modal.dataset.jobName;
    try {
      const res = await apiFetch(workspaceApiPath(workspace, `/jobs/${encodeURIComponent(jobName)}`), {
        method: "PUT",
        body: { command, icon: iconColorState.jobEdit.icon, icon_color: iconColorState.jobEdit.color, confirm: $("job-edit-confirm").checked },
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) {
        showFormError("item-edit-error", data.detail || "保存に失敗しました");
        return;
      }
      closeItemEditModal();
      await loadJobsForWorkspace();
      reopenAfterItemEdit(modal.dataset.source);
    } catch (e) {
      showFormError("item-edit-error", e.message);
    }
  }
}

function reopenAfterItemEdit(source) {
  if (source === "settings") {
    openSettingsWsVisibility();
  } else if (source === "picker-settings") {
    ensurePickerTab();
    switchTab("picker");
    const sv = $("picker-settings-view");
    if (sv) {
      showPickerSettings();
      showPickerWsVisibility(sv);
    }
  } else {
    showTerminalWsPicker();
  }
}

function closeItemEditModal() {
  $("item-edit-modal").style.display = "none";
}

async function deleteLink(workspace, index, label) {
  try {
    const res = await apiFetch(workspaceApiPath(workspace, `/links/${index}`), { method: "DELETE" });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || "削除に失敗しました");
      return;
    }
    showToast("リンクを削除しました", "success");
  } catch (e) {
    showToast(`削除エラー: ${e.message}`);
  }
}

async function deleteJob(jobName, workspace) {
  const ws = workspace || selectedWorkspace;
  if (!ws) return;

  try {
    const res = await apiFetch(workspaceApiPath(ws, `/jobs/${encodeURIComponent(jobName)}`), { method: "DELETE" });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || "削除に失敗しました");
      return;
    }
    if (selectedJob === jobName) selectedJob = null;
    await loadJobsForWorkspace();
  } catch (e) {
    showToast(`削除エラー: ${e.message}`);
  }
}
