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
  } catch (e) {
    console.error("loadJobsForWorkspace failed:", e);
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
    const checked = document.querySelector(`input[name="confirm-arg-${CSS.escape(arg.name)}"]:checked`);
    if (checked) args[arg.name] = checked.value;
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
    } catch (e) {
      console.error("job fetch failed:", e);
    }
  }
  if (!job && targetJob !== "terminal") {
    showToast(`ジョブ "${targetJob}" が見つかりません`);
    return;
  }

  if (targetJob !== "terminal" && job.terminal === false) {
    await _runJobDirect(targetJob, job, workspace);
    return;
  }

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

  addLog("ui", "job_run", { workspace, job: targetJob });
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

async function _runJobDirect(targetJob, job, workspace) {
  const label = job.label || targetJob;
  addLog("ui", "job_run_direct", { workspace, job: targetJob });
  try {
    const res = await apiFetch("/run", {
      method: "POST",
      body: { job: targetJob, args: collectConfirmArgs(), workspace },
    });
    if (!res) return;
    const data = await res.json();
    if (data.status === "error" || data.returncode !== 0) {
      const msg = (data.stderr || data.stdout || "失敗").slice(0, 200);
      showToast(`${label}: ${msg}`);
    } else {
      const msg = (data.stdout || "完了").slice(0, 200);
      showToast(`${label}: ${msg}`, "success");
    }
  } catch (e) {
    showToast(`${label}: ${e.message}`);
  }
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

function createFormSubPane(container, title, onDone, setTitleFn) {
  container.innerHTML = "";
  const sub = document.createElement("div");
  sub.className = "split-tab-settings-sub";
  if (!setTitleFn) {
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "split-tab-settings-back";
    backBtn.innerHTML = '<span class="mdi mdi-arrow-left"></span> ' + title;
    backBtn.addEventListener("click", onDone);
    sub.appendChild(backBtn);
  }
  const body = document.createElement("div");
  body.className = "split-tab-settings-body";
  sub.appendChild(body);
  container.appendChild(sub);
  return body;
}

function createCheckboxGroup(label, checked) {
  const group = document.createElement("div");
  group.className = "form-group";
  const lbl = document.createElement("label");
  lbl.className = "form-check-label";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  lbl.appendChild(input);
  lbl.append(" " + label);
  group.appendChild(lbl);
  return { group, input };
}

function createFormActions(...buttons) {
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  for (const btn of buttons) actions.appendChild(btn);
  return actions;
}

function createSubmitBtn(text, className) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className || "";
  btn.style.width = "auto";
  btn.textContent = text;
  return btn;
}

function createFormError() {
  const el = document.createElement("div");
  el.className = "form-error";
  return el;
}

function showFormErr(el, msg) {
  el.textContent = msg;
  el.style.display = "block";
}

function buildIconSelectBtn(iconState, defaultIconName, container, setTitleFn, restoreTitleFn) {
  const iconBtn = document.createElement("button");
  iconBtn.type = "button";
  iconBtn.className = "icon-select-btn";
  iconBtn.innerHTML = '<span class="icon-select-preview"></span>';

  function updatePreview() {
    const preview = iconBtn.querySelector(".icon-select-preview");
    if (!iconState.icon) {
      preview.innerHTML = renderIcon(defaultIconName, "", 18) + '<span class="icon-select-label" style="color:var(--text-muted)">アイコンを選択</span>';
    } else {
      const label = isImageDataIcon(iconState.icon) ? "favicon" : iconState.icon;
      preview.innerHTML = renderIcon(iconState.icon, iconState.color, 18) + `<span class="icon-select-label">${escapeHtml(label)}</span>`;
    }
  }

  iconBtn.addEventListener("click", () => {
    const cb = (icon, color) => {
      iconState.icon = icon;
      iconState.color = color;
      updatePreview();
      if (restoreTitleFn) restoreTitleFn();
    };
    if (container) {
      const closePicker = renderInlineIconPicker(container, cb, iconState.icon, iconState.color, !!setTitleFn);
      if (setTitleFn) {
        setTitleFn("アイコン選択", () => {
          closePicker();
          if (restoreTitleFn) restoreTitleFn();
        });
      }
    } else {
      openIconPicker(cb, iconState.icon, iconState.color);
    }
  });

  updatePreview();
  return iconBtn;
}

function buildIconGroup(iconBtn) {
  const group = document.createElement("div");
  group.className = "form-group";
  group.innerHTML = '<label class="form-label">アイコン</label>';
  const row = document.createElement("div");
  row.className = "icon-select-row";
  row.appendChild(iconBtn);
  group.appendChild(row);
  return group;
}

function renderInlineLinkCreate(container, workspace, onDone, setTitleFn) {
  const body = createFormSubPane(container, "リンク追加", onDone, setTitleFn);

  const restoreTitle = setTitleFn ? () => setTitleFn("リンク追加", onDone) : null;
  const iconState = { icon: "", color: "" };
  const iconBtn = buildIconSelectBtn(iconState, "mdi-web", container, setTitleFn, restoreTitle);
  body.appendChild(buildIconGroup(iconBtn));

  const urlGroup = document.createElement("div");
  urlGroup.className = "form-group";
  urlGroup.innerHTML = '<label class="form-label">URL</label>';
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "form-input";
  urlInput.placeholder = "http://localhost:3000";
  urlInput.autocomplete = "off";
  urlGroup.appendChild(urlInput);
  body.appendChild(urlGroup);

  const errorEl = createFormError();
  body.appendChild(errorEl);

  const submitBtn = createSubmitBtn("追加", "primary");
  body.appendChild(createFormActions(submitBtn));

  submitBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";
    const url = urlInput.value.trim();
    if (!url) { showFormErr(errorEl, "URLを入力してください"); return; }
    try {
      const res = await apiFetch(workspaceApiPath(workspace, "/links"), {
        method: "POST",
        body: { url, icon: iconState.icon, icon_color: iconState.color },
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) { showFormErr(errorEl, data.detail || "追加に失敗しました"); return; }
      await loadJobsForWorkspace();
      showToast("リンクを追加しました", "success");
      onDone();
    } catch (e) { showFormErr(errorEl, e.message); }
  });
}

function renderInlineJobCreate(container, workspace, onDone, setTitleFn) {
  const body = createFormSubPane(container, "ジョブ追加", onDone, setTitleFn);

  const restoreTitle = setTitleFn ? () => setTitleFn("ジョブ追加", onDone) : null;
  const iconState = { icon: "", color: "" };
  const iconBtn = buildIconSelectBtn(iconState, "mdi-play", container, setTitleFn, restoreTitle);
  body.appendChild(buildIconGroup(iconBtn));

  const nameGroup = document.createElement("div");
  nameGroup.className = "form-group";
  nameGroup.innerHTML = '<label class="form-label">ジョブ名 <span class="form-hint">(英数字・ハイフン・アンダースコア)</span></label>';
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "form-input";
  nameInput.placeholder = "my-job";
  nameInput.autocomplete = "off";
  nameGroup.appendChild(nameInput);
  body.appendChild(nameGroup);

  const cmdGroup = document.createElement("div");
  cmdGroup.className = "form-group";
  cmdGroup.innerHTML = '<label class="form-label">コマンド</label>';
  const cmdInput = document.createElement("input");
  cmdInput.type = "text";
  cmdInput.className = "form-input";
  cmdInput.placeholder = "echo hello";
  cmdInput.autocomplete = "off";
  cmdGroup.appendChild(cmdInput);
  body.appendChild(cmdGroup);

  const { group: confirmGroup, input: confirmCheck } = createCheckboxGroup("実行前に確認", true);
  body.appendChild(confirmGroup);
  const { group: termGroup, input: termCheck } = createCheckboxGroup("ターミナルで実行", true);
  body.appendChild(termGroup);

  const errorEl = createFormError();
  body.appendChild(errorEl);

  const submitBtn = createSubmitBtn("作成", "primary");
  body.appendChild(createFormActions(submitBtn));

  submitBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";
    const name = nameInput.value.trim();
    const command = cmdInput.value;
    if (!name) { showFormErr(errorEl, "ジョブ名を入力してください"); return; }
    if (!command.trim()) { showFormErr(errorEl, "コマンドを入力してください"); return; }
    try {
      const res = await apiFetch(workspaceApiPath(workspace, "/jobs"), {
        method: "POST",
        body: { name, command, icon: iconState.icon, icon_color: iconState.color, confirm: confirmCheck.checked, terminal: termCheck.checked },
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) { showFormErr(errorEl, data.detail || "作成に失敗しました"); return; }
      await loadJobsForWorkspace();
      onDone();
    } catch (e) { showFormErr(errorEl, e.message); }
  });
}

function renderInlineLinkEdit(container, data, onDone, setTitleFn) {
  const body = createFormSubPane(container, "リンク編集", onDone, setTitleFn);

  const restoreTitle = setTitleFn ? () => setTitleFn("リンク編集", onDone) : null;
  const iconState = { icon: data.icon || "", color: data.iconColor || "" };
  const iconBtn = buildIconSelectBtn(iconState, "mdi-web", container, setTitleFn, restoreTitle);
  body.appendChild(buildIconGroup(iconBtn));

  const urlGroup = document.createElement("div");
  urlGroup.className = "form-group";
  urlGroup.innerHTML = '<label class="form-label">URL</label>';
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "form-input";
  urlInput.placeholder = "http://localhost:3000";
  urlInput.autocomplete = "off";
  urlInput.value = data.url || "";
  urlGroup.appendChild(urlInput);
  body.appendChild(urlGroup);

  const errorEl = createFormError();
  body.appendChild(errorEl);

  const deleteBtn = createSubmitBtn("削除");
  const saveBtn = createSubmitBtn("保存", "primary");
  body.appendChild(createFormActions(deleteBtn, saveBtn));

  deleteBtn.addEventListener("click", async () => {
    await deleteLink(data.workspace, data.index, data.label);
    await loadJobsForWorkspace();
    onDone();
  });

  saveBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";
    const url = urlInput.value.trim();
    if (!url) { showFormErr(errorEl, "URLを入力してください"); return; }
    try {
      const res = await apiFetch(workspaceApiPath(data.workspace, `/links/${data.index}`), {
        method: "PUT",
        body: { url, icon: iconState.icon, icon_color: iconState.color },
      });
      if (!res) return;
      const d = await res.json();
      if (!res.ok) { showFormErr(errorEl, d.detail || "保存に失敗しました"); return; }
      await loadJobsForWorkspace();
      showToast("リンクを更新しました", "success");
      onDone();
    } catch (e) { showFormErr(errorEl, e.message); }
  });
}

function renderInlineJobEdit(container, data, onDone, setTitleFn) {
  const body = createFormSubPane(container, "ジョブ編集", onDone, setTitleFn);

  const restoreTitle = setTitleFn ? () => setTitleFn("ジョブ編集", onDone) : null;
  const iconState = { icon: data.icon || "", color: data.iconColor || "" };
  const iconBtn = buildIconSelectBtn(iconState, "mdi-play", container, setTitleFn, restoreTitle);
  body.appendChild(buildIconGroup(iconBtn));

  const nameGroup = document.createElement("div");
  nameGroup.className = "form-group";
  nameGroup.innerHTML = '<label class="form-label">ジョブ名</label>';
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "form-input";
  nameInput.disabled = true;
  nameInput.value = data.name;
  nameGroup.appendChild(nameInput);
  body.appendChild(nameGroup);

  const cmdGroup = document.createElement("div");
  cmdGroup.className = "form-group";
  cmdGroup.innerHTML = '<label class="form-label">コマンド</label>';
  const cmdInput = document.createElement("input");
  cmdInput.type = "text";
  cmdInput.className = "form-input";
  cmdInput.placeholder = "echo hello";
  cmdInput.autocomplete = "off";
  cmdInput.value = data.command || "";
  cmdGroup.appendChild(cmdInput);
  body.appendChild(cmdGroup);

  const { group: confirmGroup, input: confirmCheck } = createCheckboxGroup("実行前に確認", data.confirm !== false);
  body.appendChild(confirmGroup);
  const { group: termGroup, input: termCheck } = createCheckboxGroup("ターミナルで実行", data.terminal !== false);
  body.appendChild(termGroup);

  const errorEl = createFormError();
  body.appendChild(errorEl);

  const deleteBtn = createSubmitBtn("削除");
  const saveBtn = createSubmitBtn("保存", "primary");
  body.appendChild(createFormActions(deleteBtn, saveBtn));

  deleteBtn.addEventListener("click", async () => {
    await deleteJob(data.name, data.workspace);
    await loadJobsForWorkspace();
    onDone();
  });

  saveBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";
    const command = cmdInput.value;
    if (!command.trim()) { showFormErr(errorEl, "コマンドを入力してください"); return; }
    try {
      const res = await apiFetch(workspaceApiPath(data.workspace, `/jobs/${encodeURIComponent(data.name)}`), {
        method: "PUT",
        body: { command, icon: iconState.icon, icon_color: iconState.color, confirm: confirmCheck.checked, terminal: termCheck.checked },
      });
      if (!res) return;
      const d = await res.json();
      if (!res.ok) { showFormErr(errorEl, d.detail || "保存に失敗しました"); return; }
      await loadJobsForWorkspace();
      onDone();
    } catch (e) { showFormErr(errorEl, e.message); }
  });
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
  } catch (e) {
    showToast(`削除エラー: ${e.message}`);
  }
}
