// @ts-check

// ── Auth / App ──
export let token = "";
/** @param {string} v */
export function setToken(v) { token = v; }

// ── Jobs ──
/** @type {Record<string, any>} */
export let workspaceJobs = {};
/** @param {Record<string, any>} v */
export function setWorkspaceJobs(v) { workspaceJobs = v; }

/** @type {Record<string, any>} */
export let workspaceJobsCache = {};
/** @param {Record<string, any>} v */
export function setWorkspaceJobsCache(v) { workspaceJobsCache = v; }

/** @type {string | null} */
export let workspaceJobsLoadedFor = null;
/** @param {string | null} v */
export function setWorkspaceJobsLoadedFor(v) { workspaceJobsLoadedFor = v; }

/** @type {string | null} */
export let pendingJob = null;
/** @param {string | null} v */
export function setPendingJob(v) { pendingJob = v; }

// ── Workspaces ──
/** @type {any[]} */
export let allWorkspaces = [];
/** @param {any[]} v */
export function setAllWorkspaces(v) { allWorkspaces = v; }

/** @type {string | null} */
export let selectedWorkspace = null;
/** @param {string | null} v */
export function setSelectedWorkspace(v) { selectedWorkspace = v; }

export let isLaunchingTerminal = false;
/** @param {boolean} v */
export function setIsLaunchingTerminal(v) { isLaunchingTerminal = v; }

/** @type {string[]} */
export let cachedBranches = [];
/** @param {string[]} v */
export function setCachedBranches(v) { cachedBranches = v; }

// ── Layout ──
export const panelBottomMediaQuery = window.matchMedia("(max-width: 768px) and (orientation: portrait)");
export let panelBottom = panelBottomMediaQuery.matches;
/** @param {boolean} v */
export function setPanelBottom(v) { panelBottom = v; }

export const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

// ── Tabs ──
/** @type {any[]} */
export let openTabs = [];
/** @param {any[]} v */
export function setOpenTabs(v) { openTabs = v; }

/** @type {string | null} */
export let activeTabId = null;
/** @param {string | null} v */
export function setActiveTabId(v) { activeTabId = v; }

export let terminalIdCounter = 0;
/** @param {number} v */
export function setTerminalIdCounter(v) { terminalIdCounter = v; }

// ── Split ──
export let splitMode = false;
/** @param {boolean} v */
export function setSplitMode(v) { splitMode = v; }

/** @type {string[]} */
export let splitPaneTabIds = [];
/** @param {string[]} v */
export function setSplitPaneTabIds(v) { splitPaneTabIds = v; }

export let activePaneIndex = 0;
/** @param {number} v */
export function setActivePaneIndex(v) { activePaneIndex = v; }

/** @type {string} */
export let splitLayout = "grid";
/** @param {string} v */
export function setSplitLayout(v) { splitLayout = v; }

export let isPaneSelectedByTap = false;
/** @param {boolean} v */
export function setIsPaneSelectedByTap(v) { isPaneSelectedByTap = v; }

// ── Disconnected / Orphan sessions ──
/** @type {any[]} */
export let disconnectedSessions = [];
/** @param {any[]} v */
export function setDisconnectedSessions(v) { disconnectedSessions = v; }

/** @type {Set<string>} */
export let closedSessionUrls = new Set();
/** @param {Set<string>} v */
export function setClosedSessionUrls(v) { closedSessionUrls = v; }

export let isPageUnloading = false;
/** @param {boolean} v */
export function setIsPageUnloading(v) { isPageUnloading = v; }

export let hasRestoredTabsFromStorage = false;
/** @param {boolean} v */
export function setHasRestoredTabsFromStorage(v) { hasRestoredTabsFromStorage = v; }

export let appInitializing = false;
/** @param {boolean} v */
export function setAppInitializing(v) { appInitializing = v; }

export let isHandlingUnauthorized = false;
/** @param {boolean} v */
export function setIsHandlingUnauthorized(v) { isHandlingUnauthorized = v; }

export let serverHostname = "";
/** @param {string} v */
export function setServerHostname(v) { serverHostname = v; }

export let serverVersion = "";
/** @param {string} v */
export function setServerVersion(v) { serverVersion = v; }


// ── Terminal Settings ──
export const TERMINAL_SETTINGS_KEY = "pi_console_terminal_settings";
export const TERMINAL_SETTINGS_SCHEMA = Object.freeze({
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

export const DEFAULT_TERMINAL_SETTINGS = Object.freeze({
  fontSize: 12,
  cursorBlink: true,
  scrollback: 5000,
  scrollOnOutput: true,
});

/**
 * @param {string} key
 * @param {any} value
 * @returns {any}
 */
export function sanitizeTerminalSetting(key, value) {
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

/**
 * @param {Record<string, any>} raw
 * @returns {Record<string, any>}
 */
export function sanitizeTerminalSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const next = {};
  for (const key of Object.keys(DEFAULT_TERMINAL_SETTINGS)) {
    next[key] = sanitizeTerminalSetting(key, source[key]);
  }
  return next;
}

/** @returns {Record<string, any>} */
export function loadTerminalSettings() {
  try {
    return sanitizeTerminalSettings(JSON.parse(localStorage.getItem(TERMINAL_SETTINGS_KEY) || "{}"));
  } catch {
    return sanitizeTerminalSettings({});
  }
}

export function saveTerminalSettings() {
  localStorage.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify(terminalSettings));
}

/**
 * @param {string} key
 * @param {any} value
 * @returns {any}
 */
export function setTerminalSetting(key, value) {
  if (!(key in DEFAULT_TERMINAL_SETTINGS)) return null;
  const next = sanitizeTerminalSetting(key, value);
  terminalSettings[key] = next;
  saveTerminalSettings();
  return next;
}

/** @returns {Record<string, any>} */
export function resetTerminalSettings() {
  terminalSettings = { ...DEFAULT_TERMINAL_SETTINGS };
  saveTerminalSettings();
  return terminalSettings;
}

/** @returns {Record<string, any>} */
export function getTerminalRuntimeOptions() {
  return {
    cursorBlink: terminalSettings.cursorBlink,
    fontSize: terminalSettings.fontSize,
    fontFamily: '"Hack Nerd Font", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
    scrollback: terminalSettings.scrollback,
    scrollOnOutput: terminalSettings.scrollOnOutput,
    alternateScroll: false,
  };
}

/** @type {Record<string, any>} */
export let terminalSettings = loadTerminalSettings();

// ── panelBottomMediaQuery listener ──
// Deferred: actual handler is registered in app.js after all modules are loaded,
// because it depends on functions from settings.js, terminal-split.js, terminal-tabs.js.
