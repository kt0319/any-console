export const DRAG_THRESHOLD = 15;
export const LONG_PRESS_MS = 500;
export const FLICK_THRESHOLD = 40;
export const REPEAT_DELAY = 400;
export const REPEAT_INTERVAL = 80;
export const MIN_REPEAT_INTERVAL = 30;
export const REPEAT_ACCELERATION = 8;
export const INFINITE_SCROLL_THRESHOLD_PX = 80;

export const WS_MSG_RESIZE = 0x00;
export const WS_MSG_SCROLL = 0x01;
export const WS_MSG_CANCEL_COPY_MODE = 0x02;

export const LS_KEY_TOKEN = "pi_console_token";
export const LS_KEY_INPUT_HISTORY = "pi_console_input_history";
export const LS_KEY_TERMINAL_SETTINGS = "pi_console_terminal_settings";
export const LS_KEY_DEVICE_NAME = "deviceName";
export const LS_PREFIX_API_CACHE = "api_cache_";
export const LS_PREFIX_WS_META = "ws_meta_";
export const COOKIE_NAME_TOKEN = "pi_console_token";

export const GIT_DIFF_STATUS_CLASSES = Object.freeze({
  M: "diff-status-mod",
  A: "diff-status-add",
  D: "diff-status-del",
  "?": "diff-status-untracked",
});
