// @ts-check
import { panelBottom, getTerminalRuntimeOptions } from './state-core.js';
import { $, escapeHtml, showToast, toDisplayMessage, trapFocus } from './utils.js';
import { apiFetch, fetchAndRenderWithStatus, setInlineStatus } from './api-client.js';
import { refreshWorkspaceHeader, loadWorkspaces } from './workspace.js';
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
  for (const id of ["settings-menu-view", "settings-terminal-view", "settings-server-info-view", "settings-process-list-view", "settings-op-log-view", "settings-activity-log-view"]) {
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
 */
export async function initEditorSshHost() {
  try {
    const res = await apiFetch("/system/info");
    if (res && res.ok) {
      const data = await res.json();
      if (data.hostname && data.user) {
        _editorSshHost = `${data.user}@${data.hostname}`;
      }
      if (data.work_dir) {
        _workDir = data.work_dir;
      }
    }
  } catch { /* ignore */ }
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

export const SERVER_INFO_LABELS = {
  hostname: "ホスト名",
  ip: "IPアドレス",
  os: "OS",
  uptime: "稼働時間",
  cpu_temp: "CPU温度",
  memory: "メモリ",
  disk: "ディスク",
};

/**
 * @param {HTMLElement} container
 * @param {object} data
 */
export function renderServerInfoRows(container, data) {
  for (const [key, label] of Object.entries(SERVER_INFO_LABELS)) {
    if (!(key in data)) continue;
    const row = document.createElement("div");
    row.className = "server-info-row";
    row.innerHTML = `<span class="server-info-label">${escapeHtml(label)}</span><span class="server-info-value">${escapeHtml(String(data[key]))}</span>`;
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
 * @param {Array<{ts?: string, status_code?: number, duration_ms?: number, method?: string, path?: string, detail?: string}>} entries
 */
export function renderOpLogRows(container, entries) {
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

/**
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function renderServerInfoTo(container) {
  await fetchAndRenderWithStatus(container, "/system/info", (data) => renderServerInfoRows(container, data));
}

/**
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function renderProcessListTo(container) {
  await fetchAndRenderWithStatus(container, "/system/processes", (data) => renderProcessRows(container, data));
}

/**
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function renderOpLogTo(container) {
  await fetchAndRenderWithStatus(container, "/logs", (entries) => renderOpLogRows(container, entries));
}

/**
 * @param {{ title: string, viewId: string, listId: string, renderFn: (container: HTMLElement) => Promise<void> }} options
 * @returns {Promise<void>}
 */
export async function openSettingsDataView({
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

/**
 * @returns {Promise<void>}
 */
export async function openSettingsServerInfo() {
  await openSettingsDataView({
    title: "サーバー情報",
    viewId: "settings-server-info-view",
    listId: "server-info-list",
    renderFn: renderServerInfoTo,
  });
}

/**
 * @returns {Promise<void>}
 */
export async function openProcessList() {
  await openSettingsDataView({
    title: "プロセス一覧",
    viewId: "settings-process-list-view",
    listId: "process-list",
    renderFn: renderProcessListTo,
  });
}

/**
 * @returns {Promise<void>}
 */
export async function openOpLog() {
  await openSettingsDataView({
    title: "操作ログ",
    viewId: "settings-op-log-view",
    listId: "op-log-list",
    renderFn: renderOpLogTo,
  });
}

/**
 * @param {HTMLElement} container
 * @param {Array<{ts?: string, action?: string, detail?: string, device?: string, workspace?: string}>} entries
 */
export function renderActivityLogRows(container, entries) {
  if (entries.length === 0) {
    setInlineStatus(container, "ログなし");
    return;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const row = document.createElement("div");
    row.className = "op-log-row";
    const d = entry.ts ? new Date(entry.ts) : null;
    const ts = d ? d.toLocaleDateString("ja-JP", { month: "2-digit", day: "2-digit" }) + " " + d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    const detail = entry.detail ? ` ${entry.detail}` : "";
    const device = entry.device ? `<span class="op-log-device">${escapeHtml(entry.device)}</span>` : "";
    const ws = entry.workspace ? `<span class="op-log-ws">${escapeHtml(entry.workspace)}</span>` : "";
    row.innerHTML =
      `<span class="op-log-ts">${escapeHtml(ts)}</span>` +
      device +
      ws +
      `<span class="op-log-method">${escapeHtml(entry.action || "")}</span>` +
      `<span class="op-log-path">${escapeHtml(detail)}</span>`;
    container.appendChild(row);
  }
}

/**
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function renderActivityLogTo(container) {
  await fetchAndRenderWithStatus(container, "/op-logs", (entries) => renderActivityLogRows(container, entries));
}

/**
 * @returns {Promise<void>}
 */
export async function openActivityLog() {
  await openSettingsDataView({
    title: "操作ログ",
    viewId: "settings-activity-log-view",
    listId: "activity-log-list",
    renderFn: renderActivityLogTo,
  });
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
 * @returns {Promise<void>}
 */
export async function exportSettings() {
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

/**
 */
export function importSettings() {
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
