export function workspaceApiPath(workspace, path = "") {
  return `/workspaces/${encodeURIComponent(workspace)}${path}`;
}

export function getActionFailureMessage(data, fallback = "unknown error") {
  if (!data || typeof data !== "object") return fallback;
  if (data.stderr) return typeof data.stderr === "string" ? data.stderr : fallback;
  if (data.stdout) return typeof data.stdout === "string" ? data.stdout : fallback;
  if (data.detail) return typeof data.detail === "string" ? data.detail : fallback;
  return fallback;
}

export const EP_AUTH_CHECK = "/auth/check";
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
export const EP_SETTINGS_WORKSPACE_ROOT = "/settings/workspace-root";
export const EP_SETTINGS_EXPORT = "/settings/export";
export const EP_SETTINGS_IMPORT = "/settings/import";
export const EP_SETTINGS_CONFIG_HEALTH = "/settings/config-health";
export const EP_GITHUB_REPOS = "/github/repos";
export const EP_RECENT_JOBS = "/recent-jobs";
export const EP_SNIPPETS = "/snippets";
export const EP_UPLOAD_IMAGE = "/upload-image";

export function terminalSessionPath(sessionId) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}`;
}

export function terminalSessionBufferPath(sessionId) {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/buffer`;
}

export function workspaceGitDiscardPath(workspace) {
  return `/workspaces/${encodeURIComponent(workspace)}/git/discard`;
}

export function workspaceDownloadPath(workspace, filePath) {
  return `/workspaces/${encodeURIComponent(workspace)}/download?path=${encodeURIComponent(filePath)}`;
}

export function workspaceFileContentPath(workspace, filePath) {
  return `/workspaces/${encodeURIComponent(workspace)}/file-content?path=${encodeURIComponent(filePath)}`;
}

export function workspaceCommitMessagePath(workspace, hash) {
  return `/workspaces/${encodeURIComponent(workspace)}/commit-message?hash=${encodeURIComponent(hash)}`;
}
