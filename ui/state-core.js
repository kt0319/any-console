let token = "";
let workspaceJobs = {};
let workspaceJobsCache = {};
let workspaceJobsLoadedFor = null;
let pendingJob = null;
let allWorkspaces = [];
let selectedWorkspace = null;
let isLaunchingTerminal = false;
let cachedBranches = [];

const panelBottomMediaQuery = window.matchMedia("(max-width: 768px) and (orientation: portrait)");
let panelBottom = panelBottomMediaQuery.matches;
const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
panelBottomMediaQuery.addEventListener("change", (e) => {
  panelBottom = e.matches;
  applyPanelBottom();
  updateQuickInputVisibility();
  if (splitMode) rebuildSplitLayout();
  renderTabBar();
});

let openTabs = [];
let activeTabId = null;
let terminalIdCounter = 0;
let splitMode = false;
let splitPaneTabIds = [];
let activePaneIndex = 0;
let splitLayout = "grid";
let isPaneSelectedByTap = false;
let disconnectedSessions = [];
let closedSessionUrls = new Set();
let isPageUnloading = false;
let hasRestoredTabsFromStorage = false;

const STATUS_POLL_INTERVAL_MS = 10000;
let statusPollTimer = null;
let isPollingStatus = false;
let serverDisconnected = false;

let isHandlingUnauthorized = false;

let serverHostname = "";
let serverVersion = "";

const TERMINAL_SETTINGS_KEY = "pi_console_terminal_settings";
const TERMINAL_SETTINGS_SCHEMA = Object.freeze({
  fontSize: {
    type: "number",
    label: "フォントサイズ",
    min: 10,
    max: 24,
    step: 1,
    unit: "px",
    note: "文字サイズ。10〜24px、レイアウトへ即時反映されます。",
    requiresRefit: true,
  },
  cursorBlink: {
    type: "boolean",
    label: "カーソル点滅",
    note: "入力位置のカーソルを点滅表示します。",
  },
  scrollback: {
    type: "number",
    label: "スクロールバック",
    min: 1000,
    max: 20000,
    step: 500,
    unit: "行",
    note: "保持する過去出力の行数です。",
  },
  scrollOnOutput: {
    type: "boolean",
    label: "出力時スクロール",
    note: "新しい出力が来たとき末尾へ追従します。",
  },
});

const DEFAULT_TERMINAL_SETTINGS = Object.freeze({
  fontSize: 12,
  cursorBlink: true,
  scrollback: 5000,
  scrollOnOutput: true,
});

function sanitizeTerminalSetting(key, value) {
  const schema = TERMINAL_SETTINGS_SCHEMA[key];
  const fallback = DEFAULT_TERMINAL_SETTINGS[key];
  if (!schema) return fallback;
  if (schema.type === "boolean") return value === true || value === "true";
  if (schema.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const rounded = schema.step && schema.step >= 1 ? Math.round(num) : num;
    return Math.min(schema.max, Math.max(schema.min, rounded));
  }
  return fallback;
}

function sanitizeTerminalSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const next = {};
  for (const key of Object.keys(DEFAULT_TERMINAL_SETTINGS)) {
    next[key] = sanitizeTerminalSetting(key, source[key]);
  }
  return next;
}

function loadTerminalSettings() {
  try {
    return sanitizeTerminalSettings(JSON.parse(localStorage.getItem(TERMINAL_SETTINGS_KEY) || "{}"));
  } catch {
    return sanitizeTerminalSettings({});
  }
}

function saveTerminalSettings() {
  localStorage.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify(terminalSettings));
}

function setTerminalSetting(key, value) {
  if (!(key in DEFAULT_TERMINAL_SETTINGS)) return null;
  const next = sanitizeTerminalSetting(key, value);
  terminalSettings[key] = next;
  saveTerminalSettings();
  return next;
}

function resetTerminalSettings() {
  terminalSettings = { ...DEFAULT_TERMINAL_SETTINGS };
  saveTerminalSettings();
  return terminalSettings;
}

function getTerminalRuntimeOptions() {
  return {
    cursorBlink: terminalSettings.cursorBlink,
    fontSize: terminalSettings.fontSize,
    fontFamily: '"SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
    scrollback: terminalSettings.scrollback,
    scrollOnOutput: terminalSettings.scrollOnOutput,
  };
}

let terminalSettings = loadTerminalSettings();
