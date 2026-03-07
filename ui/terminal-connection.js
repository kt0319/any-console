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
import { removeTab, switchTab, addTerminalTab, renderTabBar } from './terminal-tabs.js';
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
 * Fetches active sessions from the server and restores validated sessions as tabs.
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
 * Restores terminal tabs from the server session list.
 * Server sessions not already open locally → restore as tabs (sorted by created_at).
 * @param {Array<Object>} sessions - List of session objects returned from the server.
 */
export function restoreValidatedTabs(sessions) {
  const localWsUrls = new Set(openTabs.filter((t) => t.type === "terminal").map((t) => t.wsUrl));

  let firstRestoredTabId = null;

  for (const session of sessions) {
    if (localWsUrls.has(session.ws_url) || closedSessionUrls.has(session.ws_url)) continue;
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

    tab.term.attachCustomWheelEventHandler(() => false);

    const frame = $(`frame-${tab.id}`);
    if (frame) {
      frame.addEventListener("wheel", (e) => {
        const isAltBuffer = tab.term.buffer.active.type === "alternate";
        const lines = Math.max(1, Math.ceil(Math.abs(e.deltaY) / 20));
        if (isAltBuffer) {
          if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
            const payload = JSON.stringify({ d: e.deltaY > 0 ? "down" : "up", n: lines });
            const bytes = new TextEncoder().encode(payload);
            const msg = new Uint8Array(1 + bytes.length);
            msg[0] = 0x01;
            msg.set(bytes, 1);
            tab.ws.send(msg);
          }
        } else {
          tab.term.scrollLines(e.deltaY > 0 ? lines : -lines);
        }
        e.preventDefault();
      }, { passive: false });
    }

    frame.addEventListener("mousedown", () => {
      if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
        tab.ws.send(new Uint8Array([0x02]));
      }
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
