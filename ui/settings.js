// @ts-check
import { panelBottom } from './state-core.js';
import { $, escapeHtml, showToast, toDisplayMessage } from './utils.js';
import { apiFetch } from './api-client.js';
import { loadWorkspaces } from './workspace.js';
import { updateSettingsConnInfo } from './auth.js';
import { invalidateWorkspaceMetaCache, invalidateGithubReposCache } from './cache.js';

/**
 */
export function applyPanelBottom() {
  document.querySelector(".main-panel").classList.toggle("panel-bottom", panelBottom);
}

/**
 * @param {string} viewId
 */
export function showSettingsView(viewId) {
  for (const id of ["settings-menu-view", "settings-terminal-view", "settings-editor-view", "settings-server-info-view", "settings-config-file-view"]) {
    const el = $(id);
    if (el) el.style.display = id === viewId ? "" : "none";
  }
}

/**
 */
export function initDeviceName() {
  const input = $("device-name-input");
  input.value = localStorage.getItem("deviceName") || "";
  input.addEventListener("input", () => {
    const name = input.value.trim();
    if (name) {
      localStorage.setItem("deviceName", name);
    } else {
      localStorage.removeItem("deviceName");
    }
  });
}

/** @type {string} */
let _editorSshHost = "";
/** @type {string} */
let _workDir = "";
/** @type {string} */
let _editorUser = "";
/** @type {string} */
let _editorHost = "";
/** @type {string} */
let _editorUrlTemplate = "";

/**
 * @returns {string}
 */
export function getEditorSshHost() {
  return _editorSshHost;
}

/**
 * @returns {string}
 */
export function getWorkDir() {
  return _workDir;
}

/**
 * @returns {string}
 */
export function getEditorUrlTemplate() {
  return _editorUrlTemplate;
}

/**
 */
export async function initEditorSshHost() {
  try {
    const res = await apiFetch("/system/info");
    if (res && res.ok) {
      const data = await res.json();
      if (data.hostname && data.user) {
        _editorSshHost = `${data.user}@${data.hostname}`;
        _editorUser = data.user;
        _editorHost = data.hostname;
      }
      if (data.work_dir) {
        _workDir = data.work_dir;
      }
    }
  } catch { /* ignore */ }
  try {
    const res = await apiFetch("/settings/editor");
    if (res && res.ok) {
      const data = await res.json();
      _editorUrlTemplate = data.url_template || "";
    }
  } catch { /* ignore */ }
}

/**
 * @param {string} workspace
 * @returns {string}
 */
export function buildEditorUrl(workspace) {
  if (!_editorUrlTemplate) return "";
  return _editorUrlTemplate
    .replace(/\{user\}/g, _editorUser)
    .replace(/\{host\}/g, _editorHost)
    .replace(/\{work_dir\}/g, _workDir)
    .replace(/\{workspace\}/g, workspace || "");
}

/**
 * @param {HTMLElement} container
 */
const EDITOR_PRESETS = [
  { label: "Zed", template: "zed://ssh/{user}@{host}{work_dir}/{workspace}" },
  { label: "VS Code", template: "vscode://vscode-remote/ssh-remote+{host}{work_dir}/{workspace}" },
  { label: "Cursor", template: "cursor://vscode-remote/ssh-remote+{host}{work_dir}/{workspace}" },
];

/**
 * @param {HTMLElement} container
 */
export function renderEditorSettingsPane(container) {
  container.innerHTML = "";

  const presetLabel = document.createElement("div");
  presetLabel.className = "settings-section-label";
  presetLabel.textContent = "プリセット";
  container.appendChild(presetLabel);

  const presetRow = document.createElement("div");
  presetRow.className = "editor-preset-row";

  /** @type {HTMLButtonElement[]} */
  const presetBtns = [];

  function updatePresetActive() {
    const current = textarea.value.trim();
    for (const btn of presetBtns) {
      btn.classList.toggle("active", btn.dataset.template === current);
    }
  }

  for (const preset of EDITOR_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "editor-preset-btn";
    btn.textContent = preset.label;
    btn.dataset.template = preset.template;
    btn.addEventListener("click", () => {
      textarea.value = preset.template;
      textarea.dispatchEvent(new Event("input"));
    });
    presetBtns.push(btn);
    presetRow.appendChild(btn);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "editor-preset-btn editor-preset-clear";
  clearBtn.textContent = "なし";
  clearBtn.dataset.template = "";
  clearBtn.addEventListener("click", () => {
    textarea.value = "";
    textarea.dispatchEvent(new Event("input"));
  });
  presetBtns.push(clearBtn);
  presetRow.appendChild(clearBtn);

  container.appendChild(presetRow);

  const label = document.createElement("div");
  label.className = "settings-section-label";
  label.textContent = "URLテンプレート";
  container.appendChild(label);

  const textarea = document.createElement("textarea");
  textarea.className = "editor-url-template-input";
  textarea.rows = 2;
  textarea.value = _editorUrlTemplate;
  textarea.placeholder = "zed://ssh/{user}@{host}{work_dir}/{workspace}";
  container.appendChild(textarea);

  const chips = document.createElement("div");
  chips.className = "editor-template-chips";
  for (const v of ["{user}", "{host}", "{work_dir}", "{workspace}"]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "editor-template-chip";
    chip.textContent = v;
    chip.addEventListener("click", () => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, start) + v + textarea.value.slice(end);
      textarea.focus();
      const pos = start + v.length;
      textarea.setSelectionRange(pos, pos);
      textarea.dispatchEvent(new Event("input"));
    });
    chips.appendChild(chip);
  }
  container.appendChild(chips);

  const previewLabel = document.createElement("div");
  previewLabel.className = "settings-section-label";
  previewLabel.textContent = "プレビュー";
  container.appendChild(previewLabel);

  const preview = document.createElement("div");
  preview.className = "editor-url-preview";
  container.appendChild(preview);

  function updatePreview() {
    const tmpl = textarea.value.trim();
    updatePresetActive();
    if (!tmpl) {
      preview.textContent = "(エディタボタン非表示)";
      return;
    }
    preview.textContent = tmpl
      .replace(/\{user\}/g, _editorUser || "user")
      .replace(/\{host\}/g, _editorHost || "host")
      .replace(/\{work_dir\}/g, _workDir || "/home/user/work")
      .replace(/\{workspace\}/g, "example-workspace");
  }
  updatePreview();

  let saveTimer = null;
  textarea.addEventListener("input", () => {
    updatePreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const url_template = textarea.value.trim();
      _editorUrlTemplate = url_template;
      await apiFetch("/settings/editor", { method: "PUT", body: { url_template } });
    }, 500);
  });
}

/**
 */
export async function openEditorSettings() {
  const title = "エディタ";
  $("settings-modal").querySelector(".modal-title").textContent = title;
  updateSettingsConnInfo();
  showSettingsView("settings-editor-view");
  $("settings-modal").style.display = "flex";
  renderEditorSettingsPane($("settings-editor-body"));
}

let _releaseFocusTrap = null;

/**
 */
export function closeSettings() {
  $("settings-modal").style.display = "none";
  if (_releaseFocusTrap) {
    _releaseFocusTrap();
    _releaseFocusTrap = null;
  }
}

/**
 * @param {HTMLElement} container
 * @param {object} data
 */
export function renderServerInfoRows(container, data) {
  const lines = [
    [data.hostname, data.os],
    [data.ip, data.uptime],
    data.cpu_temp ? [data.memory, data.cpu_temp] : [data.memory],
    [data.disk],
  ];
  for (const parts of lines) {
    const filtered = parts.filter(Boolean);
    if (filtered.length === 0) continue;
    const row = document.createElement("div");
    row.className = "server-info-compact-row";
    row.textContent = filtered.join(" | ");
    container.appendChild(row);
  }
}

/**
 * @param {HTMLElement} container
 * @param {Array<{name: string, cpu: number, mem: number, pid: number, command: string}>} processes
 */
export function renderProcessRows(container, processes) {
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

/**
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function renderServerInfoTo(container) {
  container.innerHTML = "";
  const [infoRes, procRes] = await Promise.all([
    apiFetch("/system/info"),
    apiFetch("/system/processes"),
  ]);

  if (infoRes && infoRes.ok) {
    const data = await infoRes.json();
    renderServerInfoRows(container, data);
  } else {
    const msg = document.createElement("div");
    msg.className = "status-message error";
    msg.textContent = toDisplayMessage("サーバー情報の取得に失敗しました");
    container.appendChild(msg);
  }

  const sep = document.createElement("div");
  sep.className = "process-section-separator";
  sep.textContent = "プロセス";
  container.appendChild(sep);

  if (procRes && procRes.ok) {
    const data = await procRes.json();
    renderProcessRows(container, data);
  } else {
    const msg = document.createElement("div");
    msg.className = "status-message error";
    msg.textContent = toDisplayMessage("プロセス一覧の取得に失敗しました");
    container.appendChild(msg);
  }
}

/**
 * @returns {Promise<void>}
 */
export async function openSettingsServerInfo() {
  $("settings-modal").querySelector(".modal-title").textContent = "サーバー";
  updateSettingsConnInfo();
  showSettingsView("settings-server-info-view");
  $("settings-modal").style.display = "flex";
  await renderServerInfoTo($("server-info-list"));
}

/**
 * @param {string} url
 * @returns {string}
 */
export function toSshUrl(url) {
  const m = url.match(/^https?:\/\/github\.com\/(.+)/);
  if (!m) return url;
  const path = m[1].replace(/\/$/, "");
  return `git@github.com:${path}.git`;
}

/**
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function renderConfigFileView(container) {
  container.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "config-file-toolbar";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "config-file-btn";
  downloadBtn.innerHTML = '<span class="mdi mdi-download"></span> ダウンロード';

  const uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "config-file-btn";
  uploadBtn.innerHTML = '<span class="mdi mdi-upload"></span> アップロード';

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json";
  fileInput.style.display = "none";

  toolbar.appendChild(downloadBtn);
  toolbar.appendChild(uploadBtn);
  toolbar.appendChild(fileInput);
  container.appendChild(toolbar);

  const pre = document.createElement("pre");
  pre.className = "config-file-code";
  const code = document.createElement("code");
  code.className = "language-json";
  pre.appendChild(code);
  container.appendChild(pre);

  let jsonText = "";

  /** @param {string} text */
  function updateCode(text) {
    jsonText = text;
    code.textContent = text;
    // @ts-ignore
    if (globalThis.hljs) globalThis.hljs.highlightElement(code);
  }

  try {
    const res = await apiFetch("/settings/export");
    if (!res || !res.ok) {
      updateCode("設定の取得に失敗しました");
      return;
    }
    const data = await res.json();
    updateCode(JSON.stringify(data, null, 2));
  } catch (e) {
    updateCode(e.message);
  }

  downloadBtn.addEventListener("click", () => {
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pi-console-config.json";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("設定をダウンロードしました", "success");
  });

  uploadBtn.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
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
      updateCode(JSON.stringify(data, null, 2));
      invalidateWorkspaceMetaCache();
      invalidateGithubReposCache();
      await loadWorkspaces();
    } catch (e) {
      showToast(e.message, "error");
    }
  });
}

/**
 * @returns {Promise<void>}
 */
export async function openConfigFileView() {
  const title = "設定ファイル";
  $("settings-modal").querySelector(".modal-title").textContent = title;
  updateSettingsConnInfo();
  showSettingsView("settings-config-file-view");
  $("settings-modal").style.display = "flex";
  const container = $("config-file-body");
  await renderConfigFileView(container);
}
