let sessionKeepaliveTimer = null;
let lastVisibleTime = Date.now();
const OSC_TITLE_RE = /\x1b\]0;/;

function deleteTerminalSession(sessionId) {
  apiFetch(`/terminal/sessions/${sessionId}`, { method: "DELETE" })
    .catch((e) => console.warn("session delete failed:", e));
}

function startSessionKeepalive() {
  stopSessionKeepalive();
  sessionKeepaliveTimer = setInterval(pingTerminalSessions, 5 * 60 * 1000);
}

function stopSessionKeepalive() {
  if (sessionKeepaliveTimer) {
    clearInterval(sessionKeepaliveTimer);
    sessionKeepaliveTimer = null;
  }
}

async function pingTerminalSessions() {
  const termTabs = openTabs.filter((t) => t.type === "terminal");
  if (termTabs.length === 0) return;
  try {
    await apiFetch("/terminal/sessions");
  } catch (e) { console.warn("ping sessions failed:", e); }
}

async function onVisibilityRestore() {
  const elapsed = Date.now() - lastVisibleTime;
  lastVisibleTime = Date.now();
  if (elapsed < 30_000) return;

  const termTabs = openTabs.filter((t) => t.type === "terminal");
  if (termTabs.length === 0) return;

  try {
    const res = await apiFetch("/terminal/sessions");
    if (!res || !res.ok) return;
    const sessions = await res.json();
    const aliveWsUrls = new Set(sessions.map((s) => s.ws_url));

    for (const tab of termTabs) {
      if (!aliveWsUrls.has(tab.wsUrl)) {
        disconnectedSessions.push({
          wsUrl: tab.wsUrl, workspace: tab.label, expired: true,
          icon: tab.icon?.name, iconColor: tab.icon?.color,
          tabIndex: openTabs.indexOf(tab), jobName: tab.jobName || null, jobLabel: tab.jobLabel || null,
        });
        removeTab(tab.id);
      }
    }
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

function refitActiveTerminal() {
  const tab = openTabs.find((t) => t.id === activeTabId && t.type === "terminal");
  if (!tab) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      safeFit(tab);
    });
  });
}

function syncTerminalSessionState() {
  removeLocalSessionsFromOrphans();
  if (openTabs.some((t) => t.type === "terminal")) {
    startSessionKeepalive();
  } else {
    stopSessionKeepalive();
  }
}

async function fetchOrphanSessions() {
  try {
    const res = await apiFetch("/terminal/sessions");
    if (!res || !res.ok) {
      disconnectedSessions = [];
      renderTabBar();
      return;
    }
    const sessions = await res.json();
    reconcileOrphansWithServer(sessions);
    restoreTabsFromLocalStorage(sessions);
  } catch (e) {
    console.error("fetchOrphanSessions failed:", e);
    disconnectedSessions = [];
  }
  renderTabBar();
}

function restoreTabsFromLocalStorage(sessions) {
  const raw = localStorage.getItem("pi_console_terminal_openTabs");
  localStorage.removeItem("pi_console_terminal_openTabs");
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(saved) || saved.length === 0) return;

  const serverUrls = new Set(sessions.map(s => s.ws_url));
  const orphanUrls = new Set(disconnectedSessions.map(s => s.wsUrl));

  for (const entry of saved) {
    if (!entry.wsUrl) continue;
    if (closedSessionUrls.has(entry.wsUrl)) continue;
    if (serverUrls.has(entry.wsUrl)) continue;
    if (orphanUrls.has(entry.wsUrl)) continue;
    disconnectedSessions.push({
      wsUrl: entry.wsUrl,
      workspace: entry.workspace || null,
      icon: entry.icon || null,
      iconColor: entry.iconColor || null,
      jobName: entry.jobName || null,
      jobLabel: entry.jobLabel || null,
      tabIndex: entry.tabIndex != null ? entry.tabIndex : disconnectedSessions.length,
      expired: true,
    });
  }
}

function removeLocalSessionsFromOrphans() {
  const localWsUrls = new Set(openTabs.filter((t) => t.type === "terminal").map((t) => t.wsUrl));
  disconnectedSessions = disconnectedSessions.filter((s) => !localWsUrls.has(s.wsUrl));
}

function reconcileOrphansWithServer(sessions) {
  const localWsUrls = new Set(openTabs.filter((t) => t.type === "terminal").map((t) => t.wsUrl));
  const serverUrls = new Set(sessions.map((s) => s.ws_url));
  const oldOrphans = new Map(disconnectedSessions.map((s) => [s.wsUrl, s]));

  const liveOrphans = sessions
    .filter((s) => !localWsUrls.has(s.ws_url) && !closedSessionUrls.has(s.ws_url))
    .map((s, i) => {
      const old = oldOrphans.get(s.ws_url);
      return {
        wsUrl: s.ws_url,
        workspace: s.workspace,
        expiresIn: s.expires_in,
        icon: s.icon,
        iconColor: s.icon_color,
        tabIndex: old ? old.tabIndex : openTabs.length + i,
        jobName: old ? (old.jobName || null) : null,
        jobLabel: old ? (old.jobLabel || null) : null,
        expired: false,
      };
    });

  const expiredOrphans = disconnectedSessions
    .filter((s) => !s.expired && !serverUrls.has(s.wsUrl) && !localWsUrls.has(s.wsUrl) && !closedSessionUrls.has(s.wsUrl))
    .map((s) => ({ ...s, expired: true }));

  const existingExpired = disconnectedSessions
    .filter((s) => s.expired && !closedSessionUrls.has(s.wsUrl));

  disconnectedSessions = [...liveOrphans, ...expiredOrphans, ...existingExpired];

  for (const url of closedSessionUrls) {
    if (!sessions.some((s) => s.ws_url === url)) closedSessionUrls.delete(url);
  }
}

function joinOrphanSession(wsUrl, workspace) {
  const label = workspace || "terminal";
  const orphan = disconnectedSessions.find((s) => s.wsUrl === wsUrl);
  const tabIcon = orphan && orphan.icon ? { name: orphan.icon, color: orphan.iconColor || "" } : null;
  const ws = workspace ? allWorkspaces.find((w) => w.name === workspace) : null;
  const isDuplicateIcon = ws && ws.icon && orphan && orphan.icon === ws.icon;
  const wsIcon = isDuplicateIcon ? null : (ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : null);
  addTerminalTab(wsUrl, label, null, true, false, null, tabIcon, wsIcon, orphan?.jobName || null, orphan?.jobLabel || orphan?.jobName || null);
  const tab = openTabs.find((t) => t.wsUrl === wsUrl);
  if (tab) tab._pendingRedraw = true;
  disconnectedSessions = disconnectedSessions.filter((s) => s.wsUrl !== wsUrl);
  syncTerminalSessionState();
  switchTab(tab ? tab.id : null);
}

function updateQuickInputVisibility() {
  const el = $("quick-input");
  if (!el) return;
  const show = isTouchDevice || panelBottom;
  el.style.display = show ? "" : "none";
}

function fitAndSync(tab) {
  safeFit(tab);
  const cols = tab.term.cols;
  const rows = tab.term.rows;
  if (cols < 2 || rows < 2) return;
  if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
    const resizePayload = new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify({ cols, rows }))]);
    tab.ws.send(resizePayload);
  }
}

function connectTerminalWs(tab) {
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
      fitAndSync(tab);
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
    if (e.code === 1000 || e.code === 1008) {
      if (e.code === 1008) {
        disconnectedSessions.push({
          wsUrl: tab.wsUrl, workspace: tab.label, expired: true,
          icon: tab.icon?.name, iconColor: tab.icon?.color,
          tabIndex: openTabs.indexOf(tab), jobName: tab.jobName || null, jobLabel: tab.jobLabel || null,
        });
      }
      removeTab(tab.id);
      return;
    }
    const MAX_ATTEMPTS = 10;
    if (tab._reconnectAttempts >= MAX_ATTEMPTS) {
      tab.term.write("\r\n\x1b[31m[接続が切断されました]\x1b[0m\r\n");
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
  }
}
