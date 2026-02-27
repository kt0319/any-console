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
