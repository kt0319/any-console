export function workspaceApiPath(workspace: string, path: string = ""): string {
  return `/workspaces/${encodeURIComponent(workspace)}${path}`;
}

export const EP_AUTH_CHECK = "/auth/check";
export const EP_AUTH_LOGOUT = "/auth/logout";
export const EP_AUTH_PAIRING_START = "/auth/pairing/start";
export const EP_DEVICES = "/devices";
export const EP_DEVICES_REGISTER = "/devices/register";
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
export const EP_SETTINGS_NOTIFICATIONS = "/settings/notifications";
export const EP_SETTINGS_AUTH = "/settings/auth";
export const EP_API_TOKENS = "/api-tokens";
export const EP_PUSH_VAPID_KEY = "/push/vapid-public-key";
export const EP_PUSH_SUBSCRIBE = "/push/subscribe";
export const EP_SETTINGS_CIRCLE_KEYPAD = "/settings/circle-keypad";
export const EP_SETTINGS_EXPORT = "/settings/export";
export const EP_SETTINGS_IMPORT = "/settings/import";
export const EP_SETTINGS_CONFIG_HEALTH = "/settings/config-health";
export const EP_SETTINGS_LAYOUT = "/settings/layout";
export const EP_SETTINGS_INFO_PILLS = "/settings/info-pills";
export const EP_SNIPPETS = "/snippets";
export const EP_RECENT_JOBS = "/recent-jobs";
export const EP_UPLOAD_IMAGE = "/upload-image";
export const EP_CLIENT_ERRORS = "/client-errors";
export const EP_PREVIEW_PORTS = "/preview/ports";

export function dispatchDecisionPath(dispatchId: string): string {
  return `/dispatch/${encodeURIComponent(dispatchId)}/decision`;
}

export function dispatchRerunPath(dispatchId: string): string {
  return `/dispatch/${encodeURIComponent(dispatchId)}/rerun`;
}

export function pairingStatusPath(pairingId: string): string {
  return `/auth/pairing/${encodeURIComponent(pairingId)}/status`;
}

export function pairingClaimPath(pairingId: string): string {
  return `/auth/pairing/${encodeURIComponent(pairingId)}/claim`;
}

export function devicePath(deviceId: string): string {
  return `/devices/${encodeURIComponent(deviceId)}`;
}

export function apiTokenPath(tokenId: string): string {
  return `/api-tokens/${encodeURIComponent(tokenId)}`;
}

export function terminalSessionPath(sessionId: string): string {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}`;
}

export function terminalSessionDetachedPath(sessionId: string): string {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/detached`;
}

export function terminalSessionCwdPath(sessionId: string): string {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/cwd`;
}

export function terminalSessionFilesPath(sessionId: string, path: string = ""): string {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(path)}`;
}

export function terminalSessionFileContentPath(sessionId: string, filePath: string): string {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/file-content?path=${encodeURIComponent(filePath)}`;
}

export function terminalSessionWorkspacePath(sessionId: string): string {
  return `/terminal/sessions/${encodeURIComponent(sessionId)}/workspace`;
}

export function terminalWsPath(sessionId: string): string {
  return `/terminal/ws/${sessionId}`;
}

export function terminalSessionHistoryPath(sessionId: string, opts?: { cols?: number, rows?: number }): string {
  const base = `/terminal/sessions/${encodeURIComponent(sessionId)}/history`;
  const cols = Number(opts?.cols);
  const rows = Number(opts?.rows);
  if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
    return `${base}?cols=${cols}&rows=${rows}`;
  }
  return base;
}

export function workspaceGitDiscardPath(workspace: string): string {
  return workspaceApiPath(workspace, "/git/discard");
}

export function workspaceDownloadPath(workspace: string, filePath: string): string {
  return workspaceApiPath(workspace, `/download?path=${encodeURIComponent(filePath)}`);
}

export function workspaceFileContentPath(workspace: string, filePath: string): string {
  return workspaceApiPath(workspace, `/file-content?path=${encodeURIComponent(filePath)}`);
}

export function workspaceFilesPath(workspace: string, path: string = ""): string {
  return workspaceApiPath(workspace, `/files?path=${encodeURIComponent(path)}`);
}

export function workspaceCommitDiffPath(workspace: string, hash: string): string {
  return workspaceApiPath(workspace, `/diff/${encodeURIComponent(hash)}`);
}

export function workspaceCommitMessagePath(workspace: string, hash: string): string {
  return workspaceApiPath(workspace, `/commit-message?hash=${encodeURIComponent(hash)}`);
}

export function workspaceFileHistoryPath(workspace: string, filePath: string): string {
  return workspaceApiPath(workspace, `/file-history?path=${encodeURIComponent(filePath)}`);
}

export function workspaceFileDiffPath(workspace: string, hash: string, filePath: string): string {
  return workspaceApiPath(workspace, `/file-diff/${encodeURIComponent(hash)}?path=${encodeURIComponent(filePath)}`);
}
