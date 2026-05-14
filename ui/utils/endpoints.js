/**
 * @param {string} workspace
 * @param {string} [path]
 * @returns {string}
 */
export function workspaceApiPath(workspace, path = "") {
  return `/workspaces/${encodeURIComponent(workspace)}${path}`;
}

/**
 * @param {unknown} data
 * @param {string} [fallback]
 * @returns {string}
 */
export function getActionFailureMessage(data, fallback = "unknown error") {
  if (!data || typeof data !== "object") return fallback;
  const d = /** @type {Record<string, unknown>} */ (data);
  if (d.stderr) return typeof d.stderr === "string" ? d.stderr : fallback;
  if (d.stdout) return typeof d.stdout === "string" ? d.stdout : fallback;
  if (d.detail) return typeof d.detail === "string" ? d.detail : fallback;
  return fallback;
}

export const EP_AUTH_CHECK = "/auth/check";
export const EP_AUTH_LOGIN = "/auth/login";
export const EP_AUTH_LOGOUT = "/auth/logout";
export const EP_RUN = "/run";
export const EP_WORKSPACES = "/workspaces";
export const EP_WORKSPACES_STATUSES = "/workspaces/statuses";
export const EP_WORKSPACE_ORDER = "/workspace-order";
export const EP_TERMINAL_SESSIONS = "/terminal/sessions";
export const EP_JOBS_WORKSPACES = "/jobs/workspaces";
export const EP_GLOBAL_JOBS = "/global/jobs";
export const EP_SYSTEM_INFO = "/system/info";
export const EP_SYSTEM_PROCESSES = "/system/processes";
export const EP_SETTINGS_EDITOR = "/settings/editor";
export const EP_SETTINGS_AUTH = "/settings/auth";
export const EP_SETTINGS_EXPORT = "/settings/export";
export const EP_SETTINGS_IMPORT = "/settings/import";
export const EP_SETTINGS_CONFIG_HEALTH = "/settings/config-health";
export const EP_RECENT_JOBS = "/recent-jobs";
export const EP_SNIPPETS = "/snippets";
export const EP_UPLOAD_IMAGE = "/upload-image";

/** @param {string} sessionId @returns {string} */
export function terminalSessionPath(sessionId) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}`;
}

/** @param {string} sessionId @returns {string} */
export function terminalSessionBufferPath(sessionId) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/buffer`;
}

/** @param {string} workspace @returns {string} */
export function workspaceGitDiscardPath(workspace) {
  return `/workspaces/${encodeURIComponent(workspace)}/git/discard`;
}

/** @param {string} workspace @param {string} filePath @returns {string} */
export function workspaceDownloadPath(workspace, filePath) {
  return `/workspaces/${encodeURIComponent(workspace)}/download?path=${encodeURIComponent(filePath)}`;
}

/** @param {string} workspace @param {string} filePath @returns {string} */
export function workspaceFileContentPath(workspace, filePath) {
  return `/workspaces/${encodeURIComponent(workspace)}/file-content?path=${encodeURIComponent(filePath)}`;
}

/** @param {string} workspace @param {string} hash @returns {string} */
export function workspaceCommitMessagePath(workspace, hash) {
  return `/workspaces/${encodeURIComponent(workspace)}/commit-message?hash=${encodeURIComponent(hash)}`;
}

/** @param {string} workspace @param {string} filePath @returns {string} */
export function workspaceFileHistoryPath(workspace, filePath) {
  return `/workspaces/${encodeURIComponent(workspace)}/file-history?path=${encodeURIComponent(filePath)}`;
}

/** @param {string} workspace @param {string} hash @param {string} filePath @returns {string} */
export function workspaceFileDiffPath(workspace, hash, filePath) {
  return `/workspaces/${encodeURIComponent(workspace)}/file-diff/${encodeURIComponent(hash)}?path=${encodeURIComponent(filePath)}`;
}
