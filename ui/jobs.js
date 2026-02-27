function getCachedJobsForWorkspace(workspace) {
  if (!workspace) return null;
  if (!Object.prototype.hasOwnProperty.call(workspaceJobsCache, workspace)) return null;
  return workspaceJobsCache[workspace];
}

function setCachedJobsForWorkspace(workspace, jobs) {
  if (!workspace) return;
  workspaceJobsCache[workspace] = jobs || {};
}

function invalidateWorkspaceJobsCache(workspace) {
  if (!workspace) {
    workspaceJobsCache = {};
    workspaceJobsLoadedFor = null;
    return;
  }
  delete workspaceJobsCache[workspace];
  if (workspaceJobsLoadedFor === workspace) {
    workspaceJobsLoadedFor = null;
  }
}

async function loadJobsForWorkspace(force = false) {
  if (!selectedWorkspace) {
    workspaceJobs = {};
    workspaceJobsLoadedFor = null;
    pendingJob = null;
    $("output").innerHTML = '<div class="empty-state"></div>';
    return;
  }

  const targetWorkspace = selectedWorkspace;
  const cachedJobs = getCachedJobsForWorkspace(targetWorkspace);
  if (!force && cachedJobs) {
    workspaceJobs = cachedJobs;
    workspaceJobsLoadedFor = targetWorkspace;
    pendingJob = null;
    renderTabBar();
    return;
  }
  if (!force && workspaceJobsLoadedFor === targetWorkspace) {
    pendingJob = null;
    renderTabBar();
    return;
  }

  try {
    const res = await apiFetch(workspaceApiPath(targetWorkspace, "/jobs"));
    if (!res || !res.ok) {
      if (selectedWorkspace !== targetWorkspace) return;
      if (cachedJobs) {
        workspaceJobs = cachedJobs;
        workspaceJobsLoadedFor = targetWorkspace;
      } else {
        workspaceJobs = {};
        workspaceJobsLoadedFor = null;
      }
    } else {
      const jobs = await res.json();
      if (selectedWorkspace !== targetWorkspace) return;
      workspaceJobs = jobs;
      setCachedJobsForWorkspace(targetWorkspace, jobs);
      workspaceJobsLoadedFor = targetWorkspace;
    }
  } catch (e) {
    console.error("loadJobsForWorkspace failed:", e);
    if (selectedWorkspace !== targetWorkspace) return;
    if (cachedJobs) {
      workspaceJobs = cachedJobs;
      workspaceJobsLoadedFor = targetWorkspace;
    } else {
      workspaceJobs = {};
      workspaceJobsLoadedFor = null;
    }
  }

  pendingJob = null;
  renderTabBar();
}

async function fetchWorkspaceJobDetail(workspace, jobName) {
  if (!workspace || !jobName || jobName === "terminal") return null;
  try {
    const res = await apiFetch(workspaceApiPath(workspace, `/jobs/${encodeURIComponent(jobName)}`));
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("fetchWorkspaceJobDetail failed:", e);
    return null;
  }
}

async function openJobConfirmModal(name) {
  const job = workspaceJobs[name];
  if (!job) return;
  pendingJob = name;
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
    let detail = job;
    if (!detail.command && selectedWorkspace) {
      const fetched = await fetchWorkspaceJobDetail(selectedWorkspace, name);
      if (fetched) {
        workspaceJobs[name] = { ...job, ...fetched };
        setCachedJobsForWorkspace(selectedWorkspace, workspaceJobs);
        detail = workspaceJobs[name];
      }
    }
    if (detail.command) {
      const preview = escapeHtml(detail.command.length > 300 ? detail.command.slice(0, 300) + "..." : detail.command);
      argsContainer.innerHTML = `<pre class="script-preview">${preview}</pre>`;
    }
  }

  $("job-confirm-modal").style.display = "flex";
}

function closeJobConfirmModal() {
  $("job-confirm-modal").style.display = "none";
}

function collectConfirmArgs() {
  const job = workspaceJobs[pendingJob];
  if (!job || !job.args) return {};
  const args = {};
  for (const arg of job.args) {
    const checked = document.querySelector(`input[name="confirm-arg-${CSS.escape(arg.name)}"]:checked`);
    if (checked) args[arg.name] = checked.value;
  }
  return args;
}

let jobExecutionQueue = Promise.resolve();

function resolveJobByNameOrLabel(jobs, identifier) {
  if (!jobs || identifier === "terminal") return { key: identifier, job: null };
  if (jobs[identifier]) return { key: identifier, job: jobs[identifier] };
  for (const [name, def] of Object.entries(jobs)) {
    if ((def.label || name) === identifier) {
      return { key: name, job: def };
    }
  }
  return { key: identifier, job: null };
}

async function runJob(jobName = null, argsOverride = null, workspaceOverride = null) {
  const targetJob = jobName || pendingJob;
  if (!targetJob) return Promise.resolve();
  if (pendingJob !== targetJob) {
    pendingJob = targetJob;
  }
  const runPromise = jobExecutionQueue.then(() => executeJobInTerminal(targetJob, workspaceOverride));
  jobExecutionQueue = runPromise.catch((e) => {
    console.error("runJob queue failed:", e);
  });
  return runPromise;
}

async function executeJobInTerminal(targetJob, workspaceOverride) {
  const workspace = workspaceOverride || selectedWorkspace;
  let resolvedJobKey = targetJob;
  let job = null;

  if (targetJob !== "terminal") {
    const localResolved = resolveJobByNameOrLabel(workspaceJobs, targetJob);
    resolvedJobKey = localResolved.key;
    job = localResolved.job;
  }

  if (!job && targetJob !== "terminal" && workspace) {
    const cachedWorkspaceJobs = getCachedJobsForWorkspace(workspace);
    if (cachedWorkspaceJobs) {
      const cachedResolved = resolveJobByNameOrLabel(cachedWorkspaceJobs, targetJob);
      resolvedJobKey = cachedResolved.key;
      job = cachedResolved.job;
    }
  }

  if (!job && targetJob !== "terminal" && workspace) {
    try {
      const jobsRes = await apiFetch(workspaceApiPath(workspace, "/jobs"));
      if (jobsRes && jobsRes.ok) {
        const wsJobs = await jobsRes.json();
        setCachedJobsForWorkspace(workspace, wsJobs);
        const fetchedResolved = resolveJobByNameOrLabel(wsJobs, targetJob);
        resolvedJobKey = fetchedResolved.key;
        job = fetchedResolved.job;
      }
    } catch (e) {
      console.error("job fetch failed:", e);
    }
  }
  if (!job && targetJob !== "terminal") {
    showToast(`ジョブ "${targetJob}" が見つかりません`);
    return;
  }

  if (resolvedJobKey !== "terminal" && !job.command && workspace) {
    const detailed = await fetchWorkspaceJobDetail(workspace, resolvedJobKey);
    if (detailed) {
      job = { ...job, ...detailed };
      const existingWorkspaceJobs = getCachedJobsForWorkspace(workspace) || {};
      existingWorkspaceJobs[resolvedJobKey] = job;
      setCachedJobsForWorkspace(workspace, existingWorkspaceJobs);
      if (workspace === selectedWorkspace) {
        workspaceJobs[resolvedJobKey] = job;
      }
    }
  }

  if (resolvedJobKey !== "terminal" && job.terminal === false) {
    await executeJobDirect(resolvedJobKey, job, workspace);
    return;
  }

  const tabLabel = resolvedJobKey === "terminal" ? (workspaceOverride || workspace) : (job.label || resolvedJobKey);

  let initialCommand = null;
  let tabIcon = null;
  let wsIcon = null;
  const ws = allWorkspaces.find((w) => w.name === workspace);
  const wsIconObj = ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : { name: "mdi-console", color: "" };
  if (resolvedJobKey === "terminal") {
    tabIcon = wsIconObj;
  } else if (job.command) {
    initialCommand = job.command;
    tabIcon = { name: job.icon || "mdi-play", color: job.icon_color || "" };
    wsIcon = wsIconObj;
  }

  isLaunchingTerminal = true;

  try {
    const requestedJobName = resolvedJobKey !== "terminal" ? resolvedJobKey : null;
    const requestedJobLabel = resolvedJobKey !== "terminal" ? (job.label || resolvedJobKey) : null;
    const res = await apiFetch("/run", {
      method: "POST",
      body: {
        job: "terminal",
        args: {},
        workspace,
        icon: tabIcon?.name,
        icon_color: tabIcon?.color,
        job_name: requestedJobName,
        job_label: requestedJobLabel,
      },
    });
    if (!res) return;

    const data = await res.json();
    if (data.status !== "ok" || !data.ws_url) {
      showToast(`${tabLabel} エラー: ターミナル作成に失敗`);
      return;
    }

    addTerminalTab(data.ws_url, workspace, null, false, false, initialCommand, tabIcon, wsIcon, requestedJobName, requestedJobLabel);

  } catch (e) {
    showToast(`${tabLabel} エラー: ${e.message}`);
  } finally {
    isLaunchingTerminal = false;
  }
}

async function executeJobDirect(targetJob, job, workspace) {
  const label = job.label || targetJob;
  try {
    const res = await apiFetch("/run", {
      method: "POST",
      body: { job: targetJob, args: collectConfirmArgs(), workspace },
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok || data.status === "error" || data.exit_code !== 0) {
      showToast(data.detail || data.stderr || data.stdout || "失敗");
    } else {
      const msg = (data.stdout || "完了").slice(0, 200);
      showToast(`${label}: ${msg}`, "success");
    }
  } catch (e) {
    showToast(`${label}: ${e.message}`);
  }
}


async function deleteLink(workspace, index) {
  const ok = await deleteWorkspaceAction(workspace, `/links/${index}`, "リンクを削除しました");
  if (ok) invalidateWorkspaceMetaCache(workspace);
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
  el.textContent = toDisplayMessage(msg, "入力内容を確認してください");
  el.style.display = "block";
}

async function submitWorkspaceFormAction({
  workspace,
  endpoint,
  method,
  body,
  errorEl,
  errorFallback,
  successMessage = "",
}) {
  try {
    const res = await apiFetch(workspaceApiPath(workspace, endpoint), {
      method,
      body,
    });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) {
      showFormErr(errorEl, getActionFailureMessage(data, errorFallback));
      return false;
    }
    if (successMessage) showToast(successMessage, "success");
    return true;
  } catch (e) {
    showFormErr(errorEl, e);
    return false;
  }
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

function createTextInputGroup({
  label,
  type = "text",
  placeholder = "",
  value = "",
  autocomplete = "off",
} = {}) {
  const group = document.createElement("div");
  group.className = "form-group";
  group.innerHTML = `<label class="form-label">${escapeHtml(label)}</label>`;
  const input = document.createElement("input");
  input.type = type;
  input.className = "form-input";
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  input.value = value;
  group.appendChild(input);
  return { group, input };
}

function createFormRenderer({
  container,
  title,
  workspace,
  onDone,
  setTitleFn,
  defaultIconName,
  initialIcon = "",
  initialIconColor = "",
  fields = [],
  checks = [],
  submitLabel,
  deleteLabel = "",
  onSubmit,
  onDelete = null,
}) {
  const body = createFormSubPane(container, title, onDone, setTitleFn);
  const restoreTitle = setTitleFn ? () => setTitleFn(title, onDone) : null;
  const iconState = { icon: initialIcon, color: initialIconColor };
  const iconBtn = buildIconSelectBtn(iconState, defaultIconName, container, setTitleFn, restoreTitle);
  body.appendChild(buildIconGroup(iconBtn));

  const fieldInputs = {};
  for (const def of fields) {
    const { group, input } = createTextInputGroup(def);
    body.appendChild(group);
    fieldInputs[def.name] = input;
  }

  const checkInputs = {};
  for (const def of checks) {
    const { group, input } = createCheckboxGroup(def.label, !!def.checked);
    body.appendChild(group);
    checkInputs[def.name] = input;
  }

  const errorEl = createFormError();
  body.appendChild(errorEl);

  const actions = [];
  if (onDelete) {
    const deleteBtn = createSubmitBtn(deleteLabel || "削除");
    deleteBtn.addEventListener("click", async () => {
      await onDelete({ workspace, onDone });
    });
    actions.push(deleteBtn);
  }
  const submitBtn = createSubmitBtn(submitLabel, "primary");
  submitBtn.addEventListener("click", async () => {
    await onSubmit({
      workspace,
      iconState,
      fieldInputs,
      checkInputs,
      errorEl,
      onDone,
    });
  });
  actions.push(submitBtn);
  body.appendChild(createFormActions(...actions));
}

async function finalizeWorkspaceMutation(workspace, onDone) {
  invalidateWorkspaceMetaCache(workspace);
  invalidateWorkspaceJobsCache(workspace);
  await loadJobsForWorkspace();
  onDone();
}

function validateRequiredValue(errorEl, value, message) {
  if (value) return true;
  showFormErr(errorEl, message);
  return false;
}

function buildLinkFormRendererOptions({
  container,
  workspace,
  data = null,
  onDone,
  setTitleFn,
}) {
  const isEdit = !!data;
  const targetWorkspace = isEdit ? data.workspace : workspace;
  const endpoint = isEdit ? `/links/${data.index}` : "/links";
  const method = isEdit ? "PUT" : "POST";
  return {
    container,
    title: isEdit ? "リンク編集" : "リンク追加",
    workspace: targetWorkspace,
    onDone,
    setTitleFn,
    defaultIconName: "mdi-web",
    initialIcon: data?.icon || "",
    initialIconColor: data?.iconColor || "",
    fields: [
      {
        name: "url",
        label: "URL",
        type: "url",
        placeholder: "http://localhost:3000",
        value: data?.url || "",
      },
    ],
    submitLabel: isEdit ? "保存" : "追加",
    deleteLabel: "削除",
    onDelete: isEdit ? async ({ workspace, onDone }) => {
      await deleteLink(workspace, data.index);
      await loadJobsForWorkspace();
      onDone();
    } : null,
    onSubmit: async ({ workspace, iconState, fieldInputs, errorEl, onDone }) => {
      errorEl.style.display = "none";
      const url = fieldInputs.url.value.trim();
      if (!validateRequiredValue(errorEl, url, "URLを入力してください")) return;
      const ok = await submitWorkspaceFormAction({
        workspace,
        endpoint,
        method,
        body: { url, icon: iconState.icon, icon_color: iconState.color },
        errorEl,
        errorFallback: isEdit ? "保存に失敗しました" : "追加に失敗しました",
        successMessage: isEdit ? "リンクを更新しました" : "リンクを追加しました",
      });
      if (!ok) return;
      await finalizeWorkspaceMutation(workspace, onDone);
    },
  };
}

function buildJobFormRendererOptions({
  container,
  workspace,
  data = null,
  onDone,
  setTitleFn,
}) {
  const isEdit = !!data;
  const targetWorkspace = isEdit ? data.workspace : workspace;
  const endpoint = isEdit ? `/jobs/${encodeURIComponent(data.name)}` : "/jobs";
  const method = isEdit ? "PUT" : "POST";
  return {
    container,
    title: isEdit ? "ジョブ編集" : "ジョブ追加",
    workspace: targetWorkspace,
    onDone,
    setTitleFn,
    defaultIconName: "mdi-play",
    initialIcon: data?.icon || "",
    initialIconColor: data?.iconColor || "",
    fields: [
      { name: "label", label: "表示名", placeholder: "ビルド", value: data?.label || "" },
      { name: "command", label: "コマンド", placeholder: "echo hello", value: data?.command || "" },
    ],
    checks: [
      { name: "confirm", label: "実行前に確認", checked: isEdit ? data.confirm !== false : true },
      { name: "terminal", label: "ターミナルで実行", checked: isEdit ? data.terminal !== false : true },
    ],
    submitLabel: isEdit ? "保存" : "作成",
    deleteLabel: "削除",
    onDelete: isEdit ? async ({ workspace, onDone }) => {
      await deleteJob(data.name, workspace);
      await loadJobsForWorkspace();
      onDone();
    } : null,
    onSubmit: async ({ workspace, iconState, fieldInputs, checkInputs, errorEl, onDone }) => {
      errorEl.style.display = "none";
      const label = fieldInputs.label.value.trim();
      const command = fieldInputs.command.value;
      if (!validateRequiredValue(errorEl, label, "表示名を入力してください")) return;
      if (!validateRequiredValue(errorEl, command.trim(), "コマンドを入力してください")) return;
      const ok = await submitWorkspaceFormAction({
        workspace,
        endpoint,
        method,
        body: {
          label,
          command,
          icon: iconState.icon,
          icon_color: iconState.color,
          confirm: checkInputs.confirm.checked,
          terminal: checkInputs.terminal.checked,
        },
        errorEl,
        errorFallback: isEdit ? "保存に失敗しました" : "作成に失敗しました",
      });
      if (!ok) return;
      await finalizeWorkspaceMutation(workspace, onDone);
    },
  };
}

function renderInlineLinkCreate(container, workspace, onDone, setTitleFn) {
  createFormRenderer(buildLinkFormRendererOptions({ container, workspace, onDone, setTitleFn }));
}

function renderInlineJobCreate(container, workspace, onDone, setTitleFn) {
  createFormRenderer(buildJobFormRendererOptions({ container, workspace, onDone, setTitleFn }));
}

function renderInlineLinkEdit(container, data, onDone, setTitleFn) {
  createFormRenderer(buildLinkFormRendererOptions({ container, data, onDone, setTitleFn }));
}

function renderInlineJobEdit(container, data, onDone, setTitleFn) {
  createFormRenderer(buildJobFormRendererOptions({ container, data, onDone, setTitleFn }));
}

async function deleteJob(jobName, workspace) {
  const ws = workspace || selectedWorkspace;
  if (!ws) return;

  const ok = await deleteWorkspaceAction(ws, `/jobs/${encodeURIComponent(jobName)}`, null);
  if (!ok) return;
  if (pendingJob === jobName) pendingJob = null;
  invalidateWorkspaceMetaCache(ws);
  invalidateWorkspaceJobsCache(ws);
}
