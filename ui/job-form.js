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

function renderInlineJobCreate(container, workspace, onDone, setTitleFn) {
  createFormRenderer(buildJobFormRendererOptions({ container, workspace, onDone, setTitleFn }));
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
