export const DRAG_THRESHOLD = 15;
export const LONG_PRESS_MS = 500;
export const FLICK_THRESHOLD = 40;
export const QWERTY_FLICK_THRESHOLD = 30;
export const REPEAT_DELAY = 400;
export const REPEAT_INTERVAL = 80;
export const MIN_REPEAT_INTERVAL = 30;
export const REPEAT_ACCELERATION = 8;
export const INFINITE_SCROLL_THRESHOLD_PX = 80;
export const LAYOUT_FIT_DELAY_MS = 500;
export const DEEPLINK_REFIT_DELAY_MS = 200;
export const POST_WRITE_REFRESH_MS = 300;
export const KEYBOARD_CLOSE_DELAY_MS = 500;
export const KEYBOARD_OPEN_DELAY_MS = 300;
export const ORIENTATION_CHANGE_DELAY_MS = 300;
export const DEBOUNCE_FIT_MS = 100;
export const DRAG_STATE_RESET_MS = 100;
export const WHEEL_DEBOUNCE_MS = 300;

export const WS_MSG_RESIZE = 0x00;
export const WS_CLOSE_SESSION_NOT_FOUND = 1008;
export const WS_CLOSE_SESSION_EXITED = 4001;
export const RECONNECT_INITIAL_DELAY = 200;
export const RECONNECT_BACKOFF_MULTIPLIER = 2;
export const RECONNECT_BACKOFF_BASE_MS = 1000;
export const RECONNECT_BACKOFF_MAX = 5000;
export const RECONNECTING_OVERLAY_MIN_ATTEMPTS = 2;
export const POLL_INTERVAL_MS = 5000;
export const CWD_POLL_INTERVAL_MS = 2000;
export const MOBILE_BREAKPOINT_PX = 768;
export const INPUT_HISTORY_MAX = 100;
export const GIT_LOG_ENTRIES_PER_PAGE = 30;

export const TOAST_DEFAULT_DURATION_MS = 3000;
export const URL_COPIED_RESET_MS = 1500;
export const HIDDEN_TAB_FLASH_DURATION_MS = 2000;
export const LINK_TAP_RESET_MS = 300;
export const EDITOR_CONFIG_DEBOUNCE_MS = 500;
export const FRAME_FIT_DEBOUNCE_MS = 250;
export const FIT_WRITE_QUIET_MS = 120;
export const FIT_MAX_WAIT_MS = 1000;
export const ACTIVE_FIT_DELAY_MS = 50;
export const WHEEL_FOCUS_THRESHOLD = -120;
export const DOUBLE_TAP_ZOOM_PREVENT_MS = 300;
export const HOVER_MENU_CLOSE_DELAY_MS = 150;
export const SESSION_SYNC_INTERVAL_MS = 5000;
export const CONNECTIVITY_PING_INTERVAL_MS = 3000;
export const CONNECTIVITY_PING_TIMEOUT_MS = 5000;
export const CONNECTIVITY_OFFLINE_THRESHOLD = 3;

export const LS_KEY_INPUT_HISTORY = "any_console_input_history";
export const LS_KEY_TERMINAL_SETTINGS = "any_console_terminal_settings";
export const LS_KEY_ACTIVE_SESSION = "any_console_active_session";
export const LS_KEY_DEBUG_MODE = "any_console_debug_mode";
export const LS_KEY_DEBUG_LEVELS = "any_console_debug_levels";
export const DEBUG_LEVELS = ["log", "info", "warn", "error"];
export const LS_PREFIX_API_CACHE = "api_cache_";
export const LS_PREFIX_WS_META = "ws_meta_";

export const MSG_SAVE_FAILED = "Save failed";
export const MSG_DELETE_FAILED = "Delete failed";
export const MSG_ERROR_OCCURRED = "An error occurred";

export const TERMINAL_JOB_KEY = "terminal";

export function extractApiError(data, fallback = MSG_ERROR_OCCURRED) {
  return data?.detail || data?.message || fallback;
}

export const GIT_DIFF_STATUS_CLASSES = Object.freeze({
  M: "diff-status-mod",
  A: "diff-status-add",
  D: "diff-status-del",
  "?": "diff-status-untracked",
});
