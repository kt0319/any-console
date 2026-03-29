export const DRAG_THRESHOLD = 15;
export const LONG_PRESS_MS = 500;
export const FLICK_THRESHOLD = 40;
export const REPEAT_DELAY = 400;
export const REPEAT_INTERVAL = 80;
export const MIN_REPEAT_INTERVAL = 30;
export const REPEAT_ACCELERATION = 8;
export const INFINITE_SCROLL_THRESHOLD_PX = 80;

export const WS_MSG_RESIZE = 0x00;
export const WS_CLOSE_SESSION_EXITED = 4001;
export const RECONNECT_INITIAL_DELAY = 200;
export const RECONNECT_BACKOFF_MAX = 5000;
export const POLL_INTERVAL_MS = 10000;
export const INPUT_HISTORY_MAX = 20;
export const GIT_LOG_ENTRIES_PER_PAGE = 30;

export const LS_KEY_TOKEN = "any_console_token";
export const LS_KEY_INPUT_HISTORY = "any_console_input_history";
export const LS_KEY_TERMINAL_SETTINGS = "any_console_terminal_settings";
export const LS_KEY_DEVICE_NAME = "deviceName";
export const LS_PREFIX_API_CACHE = "api_cache_";
export const LS_PREFIX_WS_META = "ws_meta_";
export const COOKIE_NAME_TOKEN = "any_console_token";

export const MSG_SAVE_FAILED = "Save failed";
export const MSG_DELETE_FAILED = "Delete failed";
export const MSG_ERROR_OCCURRED = "An error occurred";

export function extractApiError(data, fallback = MSG_ERROR_OCCURRED) {
  return data?.detail || data?.message || fallback;
}

export const GIT_DIFF_STATUS_CLASSES = Object.freeze({
  M: "diff-status-mod",
  A: "diff-status-add",
  D: "diff-status-del",
  "?": "diff-status-untracked",
});
