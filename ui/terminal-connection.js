// @ts-check
import {
  openTabs,
  setOpenTabs,
  activeTabId,
  setActiveTabId,
  allWorkspaces,
  isPageUnloading,
  closedSessionUrls,
  disconnectedSessions,
  setDisconnectedSessions,
  isTouchDevice,
  hasRestoredTabsFromStorage,
  setHasRestoredTabsFromStorage,
  panelBottom,
  splitMode,
  splitPaneTabIds,
  getTerminalRuntimeOptions,
} from './state-core.js';
import { apiFetch } from './api-client.js';
import { showToast, $, safeFit, refitTerminalWithFocus, fitTerminalAfterFonts, fitAndSync } from './utils.js';
import { removeTab, switchTab, persistOpenTabs, addTerminalTab, renderTabBar } from './terminal-tabs.js';
import { refreshTabNamePill } from './terminal-tab-pill.js';

let sessionKeepaliveTimer = null;
let lastVisibleTime = Date.now();
const OSC_TITLE_RE = /\x1b\]0;/;

/**
 * Sends a DELETE request to remove a terminal session from the server.
 * @param {string} sessionId - The ID of the session to delete.
 */
export function deleteTerminalSession(sessionId) {
  apiFetch(`/terminal/sessions/${sessionId}`, { method: "DELETE" })
    .catch((e) => console.warn("session delete failed:", e));
}

/**
 * Starts the periodic keepalive interval for terminal sessions.
 */
export function startSessionKeepalive() {
  stopSessionKeepalive();
  sessionKeepaliveTimer = setInterval(pingTerminalSessions, 5 * 60 * 1000);
}

/**
 * Stops the periodic keepalive interval for terminal sessions.
 */
export function stopSessionKeepalive() {
  if (sessionKeepaliveTimer) {
    clearInterval(sessionKeepaliveTimer);
    sessionKeepaliveTimer = null;
  }
}

/**
 * Pings the server to keep terminal sessions alive.
 * @returns {Promise<void>}
 */
export async function pingTerminalSessions() {
  const termTabs = openTabs.filter((t) => t.type === "terminal");
  if (termTabs.length === 0) return;
  try {
    await apiFetch("/terminal/sessions");
  } catch (e) { console.warn("ping sessions failed:", e); }
}

/**
 * Handles page visibility restoration by checking if any sessions have expired.
 * @returns {Promise<void>}
 */
export async function onVisibilityRestore() {
  const elapsed = Date.now() - lastVisibleTime;
  lastVisibleTime = Date.now();

  const termTabs = openTabs.filter((t) => t.type === "terminal");
  if (termTabs.length === 0) return;

  for (const tab of termTabs) {
    if (tab._replacedByOtherDevice && !tab.ws && !tab._wsDisposed) {
      tab._replacedByOtherDevice = false;
      connectTerminalWs(tab);
    }
  }

  if (elapsed < 30_000) return;

  try {
    const res = await apiFetch("/terminal/sessions");
    if (!res || !res.ok) return;
    const sessions = await res.json();
    const aliveWsUrls = new Set(sessions.map((s) => s.ws_url));

    const closedNames = [];
    for (const tab of termTabs) {
      if (!aliveWsUrls.has(tab.wsUrl)) {
        closedNames.push(tab.workspace || tab.label);
        disconnectedSessions.push({
          wsUrl: tab.wsUrl, workspace: tab.workspace || tab.label, expired: true,
          icon: tab.icon?.name, iconColor: tab.icon?.color,
          tabIndex: openTabs.indexOf(tab), jobName: tab.jobName || null, jobLabel: tab.jobLabel || null,
        });
        removeTab(tab.id, { preserveSessionForRestore: true });
      }
    }
    if (closedNames.length > 0) {
      const names = closedNames.join(", ");
      showToast(`${names}: サーバー再起動によりセッションが失われました`, "error");
    }

    for (const tab of openTabs.filter(t => t.type === "terminal")) {
      if (!tab.ws && !tab._wsDisposed && !tab._pendingOpen && aliveWsUrls.has(tab.wsUrl)) {
        connectTerminalWs(tab);
      }
    }

    restoreValidatedTabs(sessions);
    reconcileExpiredOrphansWithServer(sessions);
  } catch (e) { console.warn("onVisibilityRestore failed:", e); }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    onVisibilityRestore();
    refitActiveTerminal();
  } else {
    lastVisibleTime = Date.now();
  }
});

/**
 * Refits the currently active terminal tab using requestAnimationFrame.
 */
export function refitActiveTerminal() {
  const tab = openTabs.find((t) => t.id === activeTabId && t.type === "terminal");
  if (!tab) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      safeFit(tab);
    });
  });
}

/**
 * Syncs terminal session state: removes local sessions from orphan list and
 * starts or stops the keepalive timer based on whether any terminal tabs exist.
 */
export function syncTerminalSessionState() {
  removeLocalSessionsFromOrphans();
  if (openTabs.some((t) => t.type === "terminal")) {
    startSessionKeepalive();
  } else {
    stopSessionKeepalive();
  }
}

/**
 * Fetches active sessions from the server and restores validated sessions.
 * localStorage entries are checked against the server before being displayed as tabs.
 * @returns {Promise<void>}
 */
export async function fetchOrphanSessions() {
  try {
    const res = await apiFetch("/terminal/sessions");
    if (!res || !res.ok) {
      if (!hasRestoredTabsFromStorage) {
        restoreValidatedTabs([]);
        setHasRestoredTabsFromStorage(true);
        renderTabBar();
      }
      return;
    }
    const sessions = await res.json();
    restoreValidatedTabs(sessions);
    reconcileExpiredOrphansWithServer(sessions);
    setHasRestoredTabsFromStorage(true);
  } catch (e) {
    console.error("fetchOrphanSessions failed:", e);
    if (!hasRestoredTabsFromStorage) {
      restoreValidatedTabs([]);
      setHasRestoredTabsFromStorage(true);
    }
  }
  renderTabBar();
}

/**
 * Restores terminal tabs by validating localStorage entries against the server.
 * - localStorage entries alive on server → restore as tabs (preserving order)
 * - Server sessions not in localStorage → restore as tabs (appended)
 * - localStorage entries not on server → add to disconnectedSessions
 * @param {Array<Object>} sessions - List of session objects returned from the server.
 */
export function restoreValidatedTabs(sessions) {
  const serverMap = new Map(sessions.map((s) => [s.ws_url, s]));
  const localWsUrls = new Set(openTabs.filter((t) => t.type === "terminal").map((t) => t.wsUrl));
  const orphanUrls = new Set(disconnectedSessions.map((s) => s.wsUrl));

  const raw = localStorage.getItem("pi_console_terminal_openTabs");
  let saved = [];
  if (raw) {
    try { saved = JSON.parse(raw); } catch { saved = []; }
    if (!Array.isArray(saved)) saved = [];
    saved.sort((a, b) => (a.tabIndex ?? 0) - (b.tabIndex ?? 0));
    localStorage.removeItem("pi_console_terminal_openTabs");
  }

  const restoredUrls = new Set();
  let firstRestoredTabId = null;

  for (const entry of saved) {
    const wsUrl = entry.wsUrl || entry.ws_url;
    if (!wsUrl || closedSessionUrls.has(wsUrl) || localWsUrls.has(wsUrl)) continue;
    restoredUrls.add(wsUrl);

    if (serverMap.has(wsUrl)) {
      const session = serverMap.get(wsUrl);
      const workspace = entry.workspace || session.workspace || null;
      const tabIcon = entry.icon ? { name: entry.icon, color: entry.iconColor || "" }
        : session.icon ? { name: session.icon, color: session.icon_color || "" } : null;
      const ws = workspace ? allWorkspaces.find((w) => w.name === workspace) : null;
      const isDuplicateIcon = ws && ws.icon && tabIcon && tabIcon.name === ws.icon;
      const wsIcon = isDuplicateIcon ? null : (ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : null);
      addTerminalTab(
        wsUrl, workspace || "terminal", null, true, false, null,
        tabIcon, wsIcon,
        entry.jobName || session.job_name || null,
        entry.jobLabel || session.job_label || session.job_name || null,
      );
      const tab = openTabs.find((t) => t.wsUrl === wsUrl);
      if (!firstRestoredTabId && tab) firstRestoredTabId = tab.id;
    } else {
      if (!orphanUrls.has(wsUrl)) {
        disconnectedSessions.push({
          wsUrl,
          workspace: entry.workspace || null,
          icon: entry.icon || null,
          iconColor: entry.iconColor || entry.icon_color || null,
          jobName: entry.jobName || entry.job_name || null,
          jobLabel: entry.jobLabel || entry.job_label || null,
          tabIndex: entry.tabIndex != null ? entry.tabIndex : disconnectedSessions.length,
          expired: true,
        });
      }
    }
  }

  for (const session of sessions) {
    if (restoredUrls.has(session.ws_url) || localWsUrls.has(session.ws_url) || closedSessionUrls.has(session.ws_url)) continue;
    const workspace = session.workspace || null;
    const tabIcon = session.icon ? { name: session.icon, color: session.icon_color || "" } : null;
    const ws = workspace ? allWorkspaces.find((w) => w.name === workspace) : null;
    const isDuplicateIcon = ws && ws.icon && session.icon === ws.icon;
    const wsIcon = isDuplicateIcon ? null : (ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : null);
    addTerminalTab(
      session.ws_url, workspace || "terminal", null, true, false, null,
      tabIcon, wsIcon, session.job_name || null, session.job_label || session.job_name || null,
    );
    const tab = openTabs.find((t) => t.wsUrl === session.ws_url);
    if (!firstRestoredTabId && tab) firstRestoredTabId = tab.id;
  }

  if (!firstRestoredTabId) return;
  syncTerminalSessionState();
  if (!openTabs.some((t) => t.id === activeTabId)) switchTab(firstRestoredTabId);
}

/**
 * Removes from the disconnected sessions list any sessions that are already open locally.
 */
export function removeLocalSessionsFromOrphans() {
  const localWsUrls = new Set(openTabs.filter((t) => t.type === "terminal").map((t) => t.wsUrl));
  setDisconnectedSessions(disconnectedSessions.filter((s) => !localWsUrls.has(s.wsUrl)));
}

/**
 * Reconciles the disconnected sessions list against the server session list,
 * removing any entries that are now alive on the server or have been closed.
 * Also cleans up closedSessionUrls entries that are no longer on the server.
 * @param {Array<Object>} sessions - List of session objects returned from the server.
 */
export function reconcileExpiredOrphansWithServer(sessions) {
  const localWsUrls = new Set(openTabs.filter((t) => t.type === "terminal").map((t) => t.wsUrl));
  const serverUrls = new Set(sessions.map((s) => s.ws_url));
  setDisconnectedSessions(disconnectedSessions.filter((s) => (
    s.expired
    && !closedSessionUrls.has(s.wsUrl)
    && !localWsUrls.has(s.wsUrl)
    && !serverUrls.has(s.wsUrl)
  )));

  for (const url of closedSessionUrls) {
    if (!sessions.some((s) => s.ws_url === url)) closedSessionUrls.delete(url);
  }
}

/**
 * Updates the visibility of the quick input element based on device type and panel layout.
 */
export function updateQuickInputVisibility() {
  const el = $("quick-input");
  if (!el) return;
  const show = isTouchDevice || panelBottom;
  el.style.display = show ? "" : "none";
}


/**
 * @param {object} tab
 * @param {HTMLElement} frame
 * @returns {boolean}
 */
export function ensureTerminalOpened(tab, frame) {
  if (!tab || tab.type !== "terminal" || !tab._pendingOpen || !frame) return false;
  tab._pendingOpen = false;
  tab.term.open(frame);
  fitTerminalAfterFonts(tab);
  connectTerminalWs(tab);
  return true;
}

/**
 * Connects a WebSocket to the terminal session for the given tab,
 * handling reconnection, input binding, and message routing.
 * @param {Object} tab - The terminal tab object.
 */
export function connectTerminalWs(tab) {
  if (tab._wsDisposed) return;
  if (tab._reconnectTimer) {
    clearTimeout(tab._reconnectTimer);
    tab._reconnectTimer = null;
  }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${location.host}${tab.wsUrl}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  tab.ws = ws;
  tab._reconnectAttempts = tab._reconnectAttempts || 0;

  let scrollTimer = null;
  ws.onopen = () => {
    const restored = tab._reconnectAttempts > 0 || tab._pendingRedraw;
    tab._reconnectAttempts = 0;
    tab._pendingRedraw = false;
    const container = $(`frame-${tab.id}`);
    const isVisible = container && container.style.display !== "none";
    if (isVisible) {
      const doInitialFit = () => fitAndSync(tab);
      if (document.fonts?.ready) {
        document.fonts.ready.then(doInitialFit).catch(doInitialFit);
      } else {
        doInitialFit();
      }
    }
    if (restored) {
      tab.term.write("\x1bc");
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const cols = tab.term.cols;
          const rows = tab.term.rows;
          if (cols >= 2 && rows >= 2) {
            const smaller = JSON.stringify({ cols: cols - 1, rows });
            ws.send(new Uint8Array([0, ...new TextEncoder().encode(smaller)]));
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                const original = JSON.stringify({ cols, rows });
                ws.send(new Uint8Array([0, ...new TextEncoder().encode(original)]));
              }
            }, 100);
          }
        }
      }, 200);
    }
    if (tab._initialCommand && !tab._waitingInitialCommand) {
      tab._waitingInitialCommand = true;
    }
  };

  ws.onmessage = (e) => {
    let hasOscTitle = false;
    if (e.data instanceof ArrayBuffer) {
      if (e.data.byteLength === 0) return;
      const arr = new Uint8Array(e.data);
      hasOscTitle = arr.length >= 3 && arr.includes(0x1b) && arr.includes(0x5d);
      tab.term.write(arr);
    } else {
      if (e.data.length === 0) return;
      hasOscTitle = OSC_TITLE_RE.test(e.data);
      tab.term.write(e.data);
    }
    if (hasOscTitle && tab.id !== activeTabId && !tab._activity) {
      tab._activity = true;
      if (splitMode && document.title.startsWith("* ")) {
        document.title = document.title.slice(2);
      } else if (!splitMode && !document.title.startsWith("* ")) {
        document.title = "* " + document.title;
      }
      clearTimeout(tab._activityTimer);
      tab._activityTimer = setTimeout(() => {
        tab._activity = false;
        refreshTabNamePill(tab);
        renderTabBar();
      }, 12000);
      refreshTabNamePill(tab);
      renderTabBar();
    }
    if (tab._waitingInitialCommand && tab._initialCommand) {
      const cmd = tab._initialCommand;
      tab._initialCommand = null;
      tab._waitingInitialCommand = false;
      setTimeout(() => {
        if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
          tab.ws.send(new TextEncoder().encode(cmd + "\n"));
        }
      }, 50);
    }
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { tab.term.scrollToBottom(); scrollTimer = null; }, 200);
  };

  ws.onerror = () => {
    console.error("WebSocket error:", tab.wsUrl);
  };

  ws.onclose = (e) => {
    tab.ws = null;
    if (tab._wsDisposed || isPageUnloading) return;
    if (e.code === 4001) {
      tab._pendingRedraw = true;
      tab._replacedByOtherDevice = true;
      showToast("別のデバイスで接続されました", "info");
      return;
    }
    if (e.code === 1000 || e.code === 1008) {
      if (e.code === 1008) {
        const name = tab.workspace || tab.label;
        const reason = e.reason || "セッション切断";
        disconnectedSessions.push({
          wsUrl: tab.wsUrl, workspace: tab.workspace || tab.label, expired: true,
          icon: tab.icon?.name, iconColor: tab.icon?.color,
          tabIndex: openTabs.indexOf(tab), jobName: tab.jobName || null, jobLabel: tab.jobLabel || null,
        });
        removeTab(tab.id, { preserveSessionForRestore: true });
        showToast(`${name}: ${reason}`, "error");
      } else {
        removeTab(tab.id);
      }
      return;
    }
    const MAX_ATTEMPTS = 10;
    if (tab._reconnectAttempts >= MAX_ATTEMPTS) {
      disconnectedSessions.push({
        wsUrl: tab.wsUrl, workspace: tab.workspace || tab.label, expired: true,
        icon: tab.icon?.name, iconColor: tab.icon?.color,
        tabIndex: openTabs.indexOf(tab), jobName: tab.jobName || null, jobLabel: tab.jobLabel || null,
      });
      removeTab(tab.id, { preserveSessionForRestore: true });
      const name = tab.workspace || tab.label;
      showToast(`${name}: 再接続に失敗しました`, "error");
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, tab._reconnectAttempts), 30000);
    tab._reconnectAttempts++;
    tab._reconnectTimer = setTimeout(() => connectTerminalWs(tab), delay);
  };

  if (!tab._inputBound) {
    tab._inputBound = true;
    tab.term.onData((data) => {
      if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
        tab.ws.send(new TextEncoder().encode(data));
      }
    });
    tab.term.onResize(({ cols, rows }) => {
      if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
        const resizePayload = new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify({ cols, rows }))]);
        tab.ws.send(resizePayload);
      }
    });

    tab.term.attachCustomWheelEventHandler((e) => {
      const isAltBuffer = tab.term.buffer.active.type === "alternate";
      if (isAltBuffer) return false;
      return true;
    });

    if (isTouchDevice) {
      setupScrollBottomButton(tab);
    }
  }
}

/**
 * Sets up a scroll-to-bottom button overlay on the terminal frame.
 * Only used on touch devices.
 * @param {Object} tab - The terminal tab object.
 */
function setupScrollBottomButton(tab) {
  const frame = $(`frame-${tab.id}`);
  if (!frame) return;

  const btn = document.createElement("button");
  btn.className = "scroll-bottom-btn";
  btn.style.display = "none";
  btn.innerHTML = '<span class="mdi mdi-chevron-down"></span>';
  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    e.stopPropagation();
    tab.term.scrollToBottom();
  });
  frame.appendChild(btn);
  tab._scrollBottomBtn = btn;

  const updateScrollBtn = () => {
    const buffer = tab.term.buffer.active;
    const scrolledUp = buffer.baseY > 0 && buffer.viewportY < buffer.baseY;
    btn.style.display = scrolledUp ? "" : "none";
  };
  tab.term.onScroll(updateScrollBtn);

  requestAnimationFrame(() => {
    const viewport = frame.querySelector(".xterm-viewport");
    if (viewport) {
      viewport.addEventListener("scroll", updateScrollBtn, { passive: true });
    }
  });
  frame.addEventListener("touchend", () => {
    setTimeout(updateScrollBtn, 150);
  }, { passive: true });
}
