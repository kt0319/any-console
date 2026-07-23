/**
 * @param {string} workspace
 * @param {string} [path]
 * @returns {string}
 */
export function workspaceApiPath(workspace, path = "") {
  return `/workspaces/${encodeURIComponent(workspace)}${path}`;
}

export const EP_AUTH_CHECK = "/auth/check";
export const EP_AUTH_LOGOUT = "/auth/logout";
export const EP_RUN = "/run";
export const EP_WORKSPACES = "/workspaces";
export const EP_WORKSPACES_SUGGEST = "/workspaces/suggest";
export const EP_WORKSPACES_STATUSES = "/workspaces/statuses";
export const EP_WORKSPACES_STATUSES_WS = "/workspaces/statuses/ws";
export const EP_WORKSPACE_ORDER = "/workspace-order";
export const EP_GROUPS = "/groups";
export const EP_GROUP_ORDER = "/group-order";
export const EP_TERMINAL_SESSIONS = "/terminal/sessions";
export const EP_TERMINAL_ORDER = "/terminal/order";
export const EP_JOBS_WORKSPACES = "/jobs/workspaces";
export const EP_COMMON_JOBS = "/common/jobs";
export const EP_SYSTEM_INFO = "/system/info";
export const EP_SYSTEM_PROCESSES = "/system/processes";
export const EP_SYSTEM_TMUX_INFO = "/system/tmux-info";
export const EP_SYSTEM_TMUX_ADOPT = "/system/tmux/adopt";
export const EP_SYSTEM_TMUX_KILL = "/system/tmux/kill";
export const EP_SYSTEM_PROCESS_KILL = "/system/process/kill";
export const EP_SYSTEM_UPDATE_CHECK = "/system/update/check";
export const EP_SYSTEM_UPDATE_APPLY = "/system/update/apply";
export const EP_SETTINGS_EDITOR = "/settings/editor";
export const EP_SETTINGS_AUTH = "/settings/auth";
export const EP_PUSH_VAPID_KEY = "/push/vapid-public-key";
export const EP_PUSH_SUBSCRIBE = "/push/subscribe";
export const EP_SETTINGS_CIRCLE_KEYPAD = "/settings/circle-keypad";
export const EP_SETTINGS_EXPORT = "/settings/export";
export const EP_SETTINGS_IMPORT = "/settings/import";
export const EP_SETTINGS_CONFIG_HEALTH = "/settings/config-health";
export const EP_SETTINGS_LAYOUT = "/settings/layout";
export const EP_SNIPPETS = "/snippets";
export const EP_UPLOAD_IMAGE = "/upload-image";
export const EP_CLIENT_ERRORS = "/client-errors";

/** @param {string} dispatchId @returns {string} */
export function dispatchDecisionPath(dispatchId) {
  return `/dispatch/${encodeURIComponent(dispatchId)}/decision`;
}

/** @param {string} sessionId @returns {string} */
export function terminalSessionPath(sessionId) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}`;
}

/** @param {string} sessionId @returns {string} */
export function terminalSessionDetachedPath(sessionId) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/detached`;
}

/** @param {string} sessionId @returns {string} */
export function terminalSessionCwdPath(sessionId) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/cwd`;
}

/** @param {string} sessionId @param {string} path @returns {string} */
export function terminalSessionFilesPath(sessionId, path = "") {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(path)}`;
}

/** @param {string} sessionId @param {string} filePath @returns {string} */
export function terminalSessionFileContentPath(sessionId, filePath) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/file-content?path=${encodeURIComponent(filePath)}`;
}

/** @param {string} sessionId @returns {string} */
export function terminalSessionWorkspacePath(sessionId) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/workspace`;
}

/** @param {string} sessionId @returns {string} */
export function terminalWsPath(sessionId) {
  return `/terminal/ws/${sessionId}`;
}

/** @param {string} sessionId @param {{cols?: number, rows?: number}} [opts] @returns {string} */
export function terminalSessionHistoryPath(sessionId, opts) {
  const base = `/terminal/sessions/${encodeURIComponent(sessionId)}/history`;
  const cols = Number(opts?.cols);
  const rows = Number(opts?.rows);
  if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
    return `${base}?cols=${cols}&rows=${rows}`;
  }
  return base;
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
