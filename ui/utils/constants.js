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

export const WS_MSG_RESIZE = 0x00;
export const WS_CLOSE_SESSION_NOT_FOUND = 1008;
export const WS_CLOSE_SESSION_EXITED = 4001;
export const RECONNECT_INITIAL_DELAY = 200;
export const RECONNECT_BACKOFF_MULTIPLIER = 2;
export const RECONNECT_BACKOFF_BASE_MS = 1000;
export const RECONNECT_BACKOFF_MAX = 5000;
export const RECONNECTING_OVERLAY_MIN_ATTEMPTS = 2;
export const CWD_POLL_INTERVAL_MS = 1000;
export const DEV_SERVER_POLL_INTERVAL_MS = 10000;
// GitHub（gh CLI経由のPR/Actions一覧）の再取得間隔。ローカルのポートスキャン
// （DEV_SERVER_POLL_INTERVAL_MS）と違い外部APIを叩くため、控えめな間隔にする。
export const GITHUB_POLL_INTERVAL_MS = 30000;
export const MOBILE_BREAKPOINT_PX = 768;
export const INPUT_HISTORY_MAX = 100;
export const GIT_LOG_ENTRIES_PER_PAGE = 30;
export const RECENT_JOBS_MAX = 10;

export const TOAST_DEFAULT_DURATION_MS = 3000;
// 複数行の詳細（pull したコミット一覧等）を含むトーストは読む時間を長めに取る
export const TOAST_DETAIL_DURATION_MS = 5000;
export const PILL_MORE_PEEK_DURATION_MS = 4000;
// マーキーが末尾まで流れ終えてから、peekピル自体が消えるまでの静止時間。
// マーキーの再生時間を実際の表示時間ぴったりにすると、流れ終わった瞬間に
// 消えてしまい最後まで読めないため、この分だけ短く設定して余裕を持たせる。
export const PILL_MARQUEE_END_HOLD_MS = 800;
export const URL_COPIED_RESET_MS = 1500;
export const EDITOR_CONFIG_DEBOUNCE_MS = 500;
export const NOTIFY_GRACE_DEBOUNCE_MS = 500;
export const DIRECTORY_SUGGEST_DEBOUNCE_MS = 150;
export const LAYOUT_SAVE_DEBOUNCE_MS = 800;
// 短時間に連続する復帰トリガー（visibilitychange / focus / online）を1回にまとめる窓
export const SESSION_RESUME_COALESCE_MS = 100;
export const TOOLTIP_HIDE_DELAY_MS = 100;
// 1回の POST_WRITE_REFRESH_MS 窓内でこの回数以上 write が来たら「大量出力」と
// みなして書き込み静止後に全画面 refresh する（描画残り対策）
export const TERMINAL_BULK_WRITE_REFRESH_THRESHOLD = 50;
export const FRAME_FIT_DEBOUNCE_MS = 250;
export const FIT_WRITE_QUIET_MS = 120;
export const FIT_MAX_WAIT_MS = 1000;
export const ACTIVE_FIT_DELAY_MS = 50;
export const DOUBLE_TAP_ZOOM_PREVENT_MS = 300;
export const SESSION_SYNC_INTERVAL_MS = 3000;
export const PAIRING_STATUS_POLL_MS = 2000;
export const PAIRING_COUNTDOWN_TICK_MS = 1000;
export const PAIRING_SUCCESS_CLOSE_DELAY_MS = 1200;
// syncSessionsFromServer が起動直後のタブをサーバ未認識として誤って除去しないための猶予期間。
// SESSION_SYNC_INTERVAL_MS より長く取り、ポーリングが1周する間は除去対象にしない。
export const NEW_TAB_SYNC_GRACE_MS = 6000;
export const CONNECTIVITY_PING_INTERVAL_MS = 2000;
export const CONNECTIVITY_PING_TIMEOUT_MS = 5000;
export const CONNECTIVITY_OFFLINE_THRESHOLD = 3;
// WS が open でも受信フレーム（keepalive 含む）がこの時間途絶したら半開き接続とみなす。
// サーバの idle keepalive 間隔（WS_PING_INTERVAL_SEC=15s）の約1.3倍＋余裕。
// 検知を早めるため35sから短縮（体感の「反応しない」時間を減らす）。
export const WS_STALE_THRESHOLD_MS = 20000;

export const LS_KEY_RECENT_JOBS = "any_console_recent_jobs";
export const LS_KEY_INPUT_HISTORY = "any_console_input_history";
export const LS_KEY_TERMINAL_SETTINGS = "any_console_terminal_settings";
export const LS_KEY_ACTIVE_SESSION = "any_console_active_session";
export const LS_KEY_DEBUG_MODE = "any_console_debug_mode";
export const LS_KEY_DEBUG_LEVELS = "any_console_debug_levels";
export const LS_KEY_SESSION_SIDEBAR_OPEN = "any_console_session_sidebar_open";
export const LS_KEY_NOTIF_PREFS = "notifPrefs";

// フレーズ検出→プッシュ通知の猶予秒数のサーバ契約値
// （api/routers/settings.py の PHRASE_NOTIFY_GRACE_SEC_MAX / api/common.py の
// PHRASE_NOTIFY_IDLE_GRACE_SEC と一致させる）
export const PHRASE_NOTIFY_GRACE_SEC_MAX = 600;
export const PHRASE_NOTIFY_GRACE_SEC_DEFAULT = 20;
export const DEBUG_LEVELS = ["log", "info", "warn", "error"];
export const LS_PREFIX_API_CACHE = "api_cache_";
export const LS_PREFIX_WS_META = "ws_meta_";

export const MSG_SAVE_FAILED = "Save failed";
// ジョブ実行確認ダイアログに出すコマンドプレビューの最大文字数（format.js の
// jobCommandPreview が使用）。
export const JOB_COMMAND_PREVIEW_MAX = 300;

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
