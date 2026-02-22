let token = "";
let JOBS = {};
let selectedJob = null;
let allWorkspaces = [];
let selectedWorkspace = localStorage.getItem("pi_console_workspace") || null;
let hiddenWorkspaces = JSON.parse(localStorage.getItem("hidden_workspaces") || "[]");
let runningJobName = null;
let launchingTerminal = false;
let cachedBranches = [];
let panelBottom = localStorage.getItem("pi_console_panel_bottom") === "true";

let tabs = [];
let activeTabId = null;
let terminalIdCounter = 0;
let orphanSessions = [];
let closedSessionUrls = new Set();
const TERMINAL_TABS_KEY = "pi_console_terminal_tabs";

const QUICK_KEYS = [
  { label: "\u232B", key: "Backspace", code: "Backspace", keyCode: 8 },
  { label: "\u2190", key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  { label: "\u2193", key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  { label: "\u2191", key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  { label: "\u2192", key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  { label: "\u21B5", key: "Enter", code: "Enter", keyCode: 13 },
];
const NUMBER_KEYS = [
  { label: "1", key: "1", code: "Digit1", keyCode: 49 },
  { label: "2", key: "2", code: "Digit2", keyCode: 50 },
  { label: "3", key: "3", code: "Digit3", keyCode: 51 },
  { label: "4", key: "4", code: "Digit4", keyCode: 52 },
  { label: "5", key: "5", code: "Digit5", keyCode: 53 },
  { label: "6", key: "6", code: "Digit6", keyCode: 54 },
  { label: "7", key: "7", code: "Digit7", keyCode: 55 },
  { label: "8", key: "8", code: "Digit8", keyCode: 56 },
  { label: "9", key: "9", code: "Digit9", keyCode: 57 },
  { label: "0", key: "0", code: "Digit0", keyCode: 48 },
];
const EXTRA_MAIN_KEYS = [
  { label: "Del", key: "Delete", code: "Delete", keyCode: 46 },
  { label: "\u00AB", key: "Home", code: "Home", keyCode: 36 },
  { html: '<span class="mdi mdi-chevron-double-down"></span>', xtermScroll: "down" },
  { html: '<span class="mdi mdi-chevron-double-up"></span>', xtermScroll: "up" },
  { label: "\u00BB", key: "End", code: "End", keyCode: 35 },
];
const EXTRA_ROW_KEYS = [
  { label: "Tab", key: "Tab", code: "Tab", keyCode: 9 },
  { label: "S-Tab", shift: true, key: "Tab", code: "Tab", keyCode: 9 },
  { label: "C-c", ctrl: true, key: "c", code: "KeyC", keyCode: 67 },
  { label: "C-o", ctrl: true, key: "o", code: "KeyO", keyCode: 79 },
  { label: "/", key: "/", code: "Slash", keyCode: 191 },
  { label: "Space", key: " ", code: "Space", keyCode: 32 },
];

const AUTO_REFRESH_INTERVAL = 10000;
let autoRefreshTimer = null;
let autoRefreshing = false;

let handlingUnauthorized = false;

let createBranchFromHash = null;
const GIT_LOG_PAGE_SIZE = 30;
let gitLogLoaded = 0;
let gitLogLoading = false;
let gitLogHasMore = true;
const gitLogSeenHashes = new Set();

let diffChunks = {};
let diffFullText = "";
let diffOpenedFromGitLog = false;

let cloneTab = "github";
let selectedCloneUrl = "";
let githubRepos = [];
