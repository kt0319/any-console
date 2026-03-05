// @ts-check
import { token } from './state-core.js';
import { escapeHtml, toDisplayMessage, showToast } from './utils.js';
import { handleUnauthorized } from './auth.js';

/**
 * @param {string} endpoint
 * @param {{ method?: string, body?: any }} [options]
 * @returns {Promise<Response | null>}
 */
export async function apiFetch(endpoint, { method = "GET", body = null } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  const deviceName = localStorage.getItem("deviceName");
  if (deviceName) headers["X-Device-Name"] = deviceName;
  if (body !== null && typeof body === "object") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetch(endpoint, { method, headers, body });
  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }
  return res;
}

/**
 * @param {string} workspace
 * @param {string} [path]
 * @returns {string}
 */
export function workspaceApiPath(workspace, path = "") {
  return `/workspaces/${encodeURIComponent(workspace)}${path}`;
}

/**
 * @param {string} text
 * @param {"muted" | "error"} [tone]
 * @param {boolean} [centered]
 * @returns {string}
 */
export function renderInlineStatusHtml(text, tone = "muted", centered = true) {
  const color = tone === "error" ? "var(--error)" : "var(--text-muted)";
  const align = centered ? "text-align:center;" : "";
  return `<div style="color:${color};padding:16px;${align}">${escapeHtml(text)}</div>`;
}

/**
 * @param {HTMLElement} container
 * @param {string} text
 * @param {"muted" | "error"} [tone]
 * @param {boolean} [centered]
 * @returns {void}
 */
export function setInlineStatus(container, text, tone = "muted", centered = true) {
  container.innerHTML = renderInlineStatusHtml(text, tone, centered);
}

/**
 * @param {HTMLElement} container
 * @param {string} endpoint
 * @param {(data: any) => void | Promise<void>} renderData
 * @param {{
 *   loadingText?: string,
 *   fetchErrorText?: string,
 *   fetchErrorTone?: "muted" | "error",
 *   fetchErrorCentered?: boolean,
 *   catchErrorTone?: "muted" | "error",
 *   catchErrorCentered?: boolean,
 * }} [options]
 * @returns {Promise<boolean>}
 */
export async function fetchAndRenderWithStatus(
  container,
  endpoint,
  renderData,
  {
    loadingText = "読み込み中...",
    fetchErrorText = "取得に失敗しました",
    fetchErrorTone = "error",
    fetchErrorCentered = false,
    catchErrorTone = "error",
    catchErrorCentered = false,
  } = {},
) {
  setInlineStatus(container, loadingText);
  try {
    const res = await apiFetch(endpoint);
    if (!res || !res.ok) {
      setInlineStatus(container, fetchErrorText, fetchErrorTone, fetchErrorCentered);
      return false;
    }
    const data = await res.json();
    container.innerHTML = "";
    await renderData(data);
    return true;
  } catch (e) {
    setInlineStatus(container, e.message, catchErrorTone, catchErrorCentered);
    return false;
  }
}

/**
 * @param {HTMLElement} container
 * @param {string} variant
 * @param {string} text
 * @returns {void}
 */
export function setListStatus(container, variant, text) {
  container.innerHTML = `<div class="clone-repo-${variant}">${escapeHtml(text)}</div>`;
}

/**
 * @param {any} data
 * @param {string} [fallback]
 * @returns {string}
 */
export function getActionFailureMessage(data, fallback = "unknown error") {
  if (!data || typeof data !== "object") return fallback;
  return toDisplayMessage(data.stderr || data.stdout || data.detail, fallback);
}

/**
 * @param {string} workspace
 * @param {string} endpoint
 * @param {string} label
 * @param {any} [body]
 * @returns {Promise<any | null>}
 */
export async function postWorkspaceAction(workspace, endpoint, label, body = null) {
  try {
    const res = await apiFetch(workspaceApiPath(workspace, endpoint), {
      method: "POST",
      body,
    });
    if (!res) return null;
    const data = await res.json();
    if (data.status === "ok") {
      showToast(`${workspace}: ${label} 完了`, "success");
      return data;
    }
    showToast(`${label} 失敗: ${getActionFailureMessage(data)}`);
    return data;
  } catch (e) {
    showToast(`${label} エラー: ${e.message}`);
    return null;
  }
}

/**
 * @param {string} workspace
 * @param {string} endpoint
 * @param {string} successMessage
 * @param {string} [defaultError]
 * @returns {Promise<boolean>}
 */
export async function deleteWorkspaceAction(
  workspace,
  endpoint,
  successMessage,
  defaultError = "削除に失敗しました",
) {
  try {
    const res = await apiFetch(workspaceApiPath(workspace, endpoint), { method: "DELETE" });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || defaultError);
      return false;
    }
    if (successMessage) showToast(successMessage, "success");
    return true;
  } catch (e) {
    showToast(`削除エラー: ${e.message}`);
    return false;
  }
}

/**
 * @param {string} workspace
 * @param {any} body
 * @returns {Promise<{ ok: boolean, data: any, error?: Error }>}
 */
export async function putWorkspaceConfig(workspace, body) {
  try {
    const res = await apiFetch(workspaceApiPath(workspace, "/config"), {
      method: "PUT",
      body,
    });
    if (!res) return { ok: false, data: null };
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, error: e };
  }
}
