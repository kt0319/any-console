let sessionKeepaliveTimer = null;
let lastVisibleTime = Date.now();
let tabDragState = null;
const OSC_TITLE_RE = /\x1b\]0;/;

function renderTabIconHtml(tab, size = 14) {
  return (tab.wsIcon ? renderIcon(tab.wsIcon.name, tab.wsIcon.color, size) : "")
       + (tab.icon ? renderIcon(tab.icon.name, tab.icon.color, size) : "");
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
  const termTabs = tabs.filter((t) => t.type === "terminal");
  if (termTabs.length === 0) return;
  try {
    await apiFetch("/terminal/sessions");
  } catch {}
}

async function onVisibilityRestore() {
  const elapsed = Date.now() - lastVisibleTime;
  lastVisibleTime = Date.now();
  if (elapsed < 30_000) return;

  const termTabs = tabs.filter((t) => t.type === "terminal");
  if (termTabs.length === 0) return;

  try {
    const res = await apiFetch("/terminal/sessions");
    if (!res || !res.ok) return;
    const sessions = await res.json();
    const aliveWsUrls = new Set(sessions.map((s) => s.ws_url));

    for (const tab of termTabs) {
      if (!aliveWsUrls.has(tab.wsUrl)) {
        removeTab(tab.id);
        showToast("ターミナルセッションが期限切れになりました");
      }
    }
  } catch {}
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
  const tab = tabs.find((t) => t.id === activeTabId && t.type === "terminal");
  if (!tab) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try { tab.fitAddon.fit(); } catch {}
    });
  });
}

function saveTerminalTabs() {
  updateOrphanSessions();
  if (tabs.some((t) => t.type === "terminal")) {
    startSessionKeepalive();
  } else {
    stopSessionKeepalive();
  }
}

async function fetchOrphanSessions() {
  try {
    const res = await apiFetch("/terminal/sessions");
    if (!res || !res.ok) {
      orphanSessions = [];
      renderTabBar();
      return;
    }
    const sessions = await res.json();
    updateOrphanFromSessions(sessions);
  } catch (e) {
    console.error("fetchOrphanSessions failed:", e);
    orphanSessions = [];
  }
  renderTabBar();
}

function updateOrphanSessions() {
  const localWsUrls = new Set(tabs.filter((t) => t.type === "terminal").map((t) => t.wsUrl));
  orphanSessions = orphanSessions.filter((s) => !localWsUrls.has(s.wsUrl));
}

function updateOrphanFromSessions(sessions) {
  const localWsUrls = new Set(tabs.filter((t) => t.type === "terminal").map((t) => t.wsUrl));
  const nonPickerCount = tabs.filter((t) => t.type !== "picker").length;
  const oldOrphans = new Map(orphanSessions.map((s) => [s.wsUrl, s]));
  orphanSessions = sessions
    .filter((s) => !localWsUrls.has(s.ws_url) && !closedSessionUrls.has(s.ws_url))
    .map((s, i) => {
      const old = oldOrphans.get(s.ws_url);
      return { wsUrl: s.ws_url, workspace: s.workspace, expiresIn: s.expires_in, icon: s.icon, iconColor: s.icon_color, tabIndex: old ? old.tabIndex : nonPickerCount + i };
    });
  for (const url of closedSessionUrls) {
    if (!sessions.some((s) => s.ws_url === url)) closedSessionUrls.delete(url);
  }
}

function joinOrphanSession(wsUrl, workspace) {
  const label = workspace || "terminal";
  const orphan = orphanSessions.find((s) => s.wsUrl === wsUrl);
  const tabIcon = orphan && orphan.icon ? { name: orphan.icon, color: orphan.iconColor || "" } : null;
  const ws = workspace ? allWorkspaces.find((w) => w.name === workspace) : null;
  const isDuplicateIcon = ws && ws.icon && orphan && orphan.icon === ws.icon;
  const wsIcon = isDuplicateIcon ? null : (ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : null);
  addTerminalTab(wsUrl, label, null, true, false, null, tabIcon, wsIcon);
  const tab = tabs.find((t) => t.wsUrl === wsUrl);
  if (tab) tab._pendingRedraw = true;
  orphanSessions = orphanSessions.filter((s) => s.wsUrl !== wsUrl);
  saveTerminalTabs();
  switchTab(tab ? tab.id : null);
}

function updateQuickInputVisibility() {
  const el = $("quick-input");
  if (!el) return;
  const show = isTouchDevice || panelBottom;
  el.style.display = show ? "" : "none";
}

function fitAndSync(tab) {
  try { tab.fitAddon.fit(); } catch {}
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
    addLog("ws", "open", { url: tab.wsUrl });
    const restored = tab._reconnectAttempts > 0 || tab._pendingRedraw;
    tab._reconnectAttempts = 0;
    tab._pendingRedraw = false;
    const container = $(`frame-${tab.id}`);
    const isVisible = container && container.style.display !== "none";
    if (isVisible) {
      fitAndSync(tab);
    }
    if (restored) {
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
      clearTimeout(tab._activityTimer);
      tab._activityTimer = setTimeout(() => {
        tab._activity = false;
        renderTabBar();
      }, 12000);
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
    addLog("ws", "error", { url: tab.wsUrl });
    console.error("WebSocket error:", tab.wsUrl);
  };

  ws.onclose = (e) => {
    addLog("ws", "close", { url: tab.wsUrl, code: e.code });
    tab.ws = null;
    if (tab._wsDisposed || isPageUnloading) return;
    if (e.code === 1000 || e.code === 1008) {
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


function tabDisplayName(tab) {
  if (!tab) return "";
  const parts = [tab.workspace || tab.label];
  if (tab.jobName) parts.push(tab.jobName);
  return parts.join(" / ");
}

function removePickerTab() {
  const pickerIdx = tabs.findIndex((t) => t.type === "picker");
  if (pickerIdx >= 0) {
    tabs.splice(pickerIdx, 1);
    const pickerEl = $("frame-picker");
    if (pickerEl) pickerEl.remove();
  }
}

function addTerminalTab(wsUrl, workspace, tabId, skipSwitch, restored, initialCommand, tabIcon, wsIcon, jobName) {
  removePickerTab();
  const id = tabId || `term-${++terminalIdCounter}`;
  if (tabId) {
    const m = tabId.match(/^term-(\d+)$/);
    if (m) terminalIdCounter = Math.max(terminalIdCounter, parseInt(m[1]));
  }
  const label = workspace || "terminal";
  if (tabs.some((t) => t.id === id)) return;

  const container = document.createElement("div");
  container.className = "terminal-frame";
  container.id = `frame-${id}`;
  container.style.display = "none";
  $("output-container").appendChild(container);

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: "'JetBrainsMono Nerd Font', 'Hack Nerd Font', 'FiraCode Nerd Font', 'MesloLGS NF', monospace",
    scrollback: 5000,
    scrollOnOutput: true,
    theme: {
      background: "#1a1b26",
      foreground: "#e0e4fc",
      cursor: "#82aaff",
      selectionBackground: "rgba(130, 170, 255, 0.3)",
    },
  });
  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon((e, uri) => {
    window.open(uri, "_blank", "noopener");
  });
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown" && e.key === "v" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      return false;
    }
    return true;
  });

  let touchStartY = null;
  container.addEventListener("touchstart", (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  container.addEventListener("touchend", (e) => {
    if (container.classList.contains("view-mode")) return;
    if (splitMode) return;
    if (!isTouchDevice) return;
    const endY = e.changedTouches[0].clientY;
    if (touchStartY !== null && Math.abs(endY - touchStartY) > 10) return;
    showKeyboardInput();
  });


  const tab = { id, type: "terminal", wsUrl, label, term, fitAddon, ws: null, _initialCommand: initialCommand || null, icon: tabIcon || null, wsIcon: wsIcon || null, jobName: jobName || null, _pendingOpen: !!restored, _pendingRedraw: !!restored };
  insertBeforePicker(tab);

  if (!restored) {
    term.open(container);
    connectTerminalWs(tab);
  }

  if (skipSwitch) return;
  saveTerminalTabs();
  switchTab(id);
}

function setOutputTab(id, label, htmlContent, icon, wsIcon, workspace) {
  removePickerTab();
  const existing = tabs.find((t) => t.id === id);
  if (existing) {
    existing.label = label;
    if (icon !== undefined) existing.icon = icon;
    if (wsIcon !== undefined) existing.wsIcon = wsIcon;
    if (workspace !== undefined) existing.workspace = workspace;
    const el = $(`frame-${id}`);
    if (el) el.innerHTML = htmlContent;
    switchTab(id);
    return;
  }
  insertBeforePicker({ id, type: "output", label, icon: icon || null, wsIcon: wsIcon || null, workspace: workspace || null });
  const div = document.createElement("div");
  div.className = "output-area";
  div.id = `frame-${id}`;
  div.innerHTML = htmlContent;
  div.style.display = "none";
  $("output-container").appendChild(div);
  switchTab(id);
}

function removeTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tab.type === "picker") return;

  if (splitMode) {
    const container = $("output-container");
    const frame = $(`frame-${id}`);
    if (frame) {
      const pane = frame.closest(".split-pane");
      if (pane) container.appendChild(frame);
    }
  }

  if (tab.type === "terminal") {
    if (tab.wsUrl) {
      closedSessionUrls.add(tab.wsUrl);
      const match = tab.wsUrl.match(/\/terminal\/ws\/([^/]+)/);
      if (match) {
        apiFetch(`/terminal/sessions/${match[1]}`, { method: "DELETE" }).catch(() => {});
      }
    }
    tab._wsDisposed = true;
    if (tab._reconnectTimer) clearTimeout(tab._reconnectTimer);
    if (tab.ws) tab.ws.close();
    if (tab.term) tab.term.dispose();
  }
  tabs = tabs.filter((t) => t.id !== id);
  const el = $(`frame-${id}`);
  if (el) el.remove();
  saveTerminalTabs();

  if (splitMode) {
    const nonPicker = getNonPickerTabs();
    if (nonPicker.length < 2) {
      const remaining = nonPicker.length > 0 ? nonPicker[0].id : "picker";
      exitSplitModeWithTab(remaining);
      return;
    }
    rebuildSplitLayout();
    return;
  }

  if (activeTabId === id) {
    const nonPicker = tabs.filter((t) => t.type !== "picker");
    const next = nonPicker.length > 0 ? nonPicker[nonPicker.length - 1].id : "picker";
    switchTab(next);
  } else {
    renderTabBar();
  }
}

async function switchTab(id) {
  if (splitMode) {
    const switchedTab = tabs.find((t) => t.id === id);
    if (switchedTab) switchedTab._activity = false;

    const nonPicker = getNonPickerTabs();
    const needsRebuild = nonPicker.length !== splitPaneTabIds.length ||
      nonPicker.some((t) => !splitPaneTabIds.includes(t.id));
    if (needsRebuild) {
      splitPaneTabIds = nonPicker.map((t) => t.id);
      const idx = splitPaneTabIds.indexOf(id);
      activePaneIndex = idx >= 0 ? idx : 0;
      activeTabId = splitPaneTabIds[activePaneIndex];
      rebuildSplitLayout();
    } else {
      const paneIdx = splitPaneTabIds.indexOf(id);
      if (paneIdx >= 0) setActivePaneIndex(paneIdx);
    }
    await updateHeaderForTab(activeTabId);
    return;
  }

  for (const t of tabs) {
    if (t.type === "terminal") exitTerminalCopyMode(t.id);
  }

  activeTabId = id;
  const switchedTab = tabs.find((t) => t.id === id);
  if (switchedTab) switchedTab._activity = false;
  $("output").style.display = id === null ? "" : "none";
  for (const tab of tabs) {
    const el = $(`frame-${tab.id}`);
    if (el) {
      if (tab.id === id) {
        el.style.display = tab.type === "terminal" ? "block" : "";
        if (tab.type === "terminal") {
          if (tab._pendingOpen) {
            tab._pendingOpen = false;
            tab.term.open(el);
            connectTerminalWs(tab);
          } else {
            const doFit = () => {
              fitAndSync(tab);
              tab.term.focus();
            };
            requestAnimationFrame(() => {
              requestAnimationFrame(() => doFit());
            });
            setTimeout(() => doFit(), 300);
          }
        }
      } else {
        el.style.display = "none";
      }
    }
  }
  updateQuickInputVisibility();
  renderTabBar();

  await updateHeaderForTab(id);
}

async function updateHeaderForTab(id) {
  if (splitMode) {
    $("header-row2").style.display = "none";
    return;
  }

  const switchedTabObj = tabs.find((t) => t.id === id);
  if (switchedTabObj && switchedTabObj.type === "picker") {
    resetPickerView();
    $("header-row2").style.display = "none";
    return;
  }

  $("header-row2").style.display = "flex";

  if (id === null) {
    selectedWorkspace = null;
    await updateHeaderInfo();
    await loadJobsForWorkspace();
    return;
  }

  const activeTab = tabs.find((t) => t.id === id);
  const isTerminalTab = activeTab && activeTab.type === "terminal";

  if (isTerminalTab && activeTab.label) {
    const ws = allWorkspaces.find((w) => w.name === activeTab.label);
    if (ws) {
      if (ws.name !== selectedWorkspace) {
        selectedWorkspace = ws.name;
        await loadJobsForWorkspace();
      }
      await updateHeaderInfo();
    }
  }
}

function bindMouseDrag(btn, tab) {
  const DRAG_THRESHOLD = 5;
  let startX = 0;
  let mouseDown = false;
  btn.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains("tab-close")) return;
    startX = e.clientX;
    mouseDown = true;
    const onMove = (me) => {
      if (!mouseDown) return;
      if (Math.abs(me.clientX - startX) > DRAG_THRESHOLD) {
        mouseDown = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        startTabDrag(btn, tab, { clientX: startX });
      }
    };
    const onUp = () => {
      mouseDown = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function startTabDrag(btn, tab, pointer) {
  const bar = $("tab-bar");
  const rect = btn.getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();

  const placeholder = document.createElement("div");
  placeholder.className = "tab-drag-placeholder";
  placeholder.style.width = rect.width + "px";
  placeholder.style.height = rect.height + "px";
  btn.parentNode.insertBefore(placeholder, btn);

  btn.classList.add("tab-dragging");
  btn.style.position = "fixed";
  btn.style.top = rect.top + "px";
  btn.style.left = rect.left + "px";
  btn.style.width = rect.width + "px";
  btn.style.zIndex = "100";

  const offsetX = pointer.clientX - rect.left;
  const isTouch = !!pointer.touches;

  tabDragState = {
    btn,
    tab,
    placeholder,
    bar,
    barRect,
    offsetX,
    startX: pointer.clientX,
    moved: false,
    isTouch,
  };

  navigator.vibrate?.(30);

  if (isTouch) {
    document.addEventListener("touchmove", onTabDragMove, { capture: true, passive: false });
    document.addEventListener("touchend", onTabDragEnd, { capture: true });
  } else {
    document.addEventListener("mousemove", onTabDragMove, { capture: true });
    document.addEventListener("mouseup", onTabDragEnd, { capture: true });
  }
}

function getPointerXFromEvent(e) {
  return e.touches ? e.touches[0].clientX : e.clientX;
}

function onTabDragMove(e) {
  if (!tabDragState) return;
  e.preventDefault();
  const clientX = getPointerXFromEvent(e);
  const { btn, bar, barRect, offsetX } = tabDragState;

  const dx = Math.abs(clientX - tabDragState.startX);
  if (dx > 5) tabDragState.moved = true;

  btn.style.left = (clientX - offsetX) + "px";

  const siblings = Array.from(bar.querySelectorAll(".tab-btn:not(.tab-dragging), .tab-drag-placeholder"));
  for (const sib of siblings) {
    if (sib === tabDragState.placeholder) continue;
    if (sib.classList.contains("tab-add-btn") || sib.classList.contains("split-toggle-btn")) continue;
    const sibRect = sib.getBoundingClientRect();
    const sibCenter = sibRect.left + sibRect.width / 2;
    if (clientX < sibCenter) {
      bar.insertBefore(tabDragState.placeholder, sib);
      return;
    }
  }
  const lastNonUtil = [...bar.querySelectorAll(".tab-btn:not(.tab-dragging):not(.tab-add-btn):not(.split-toggle-btn), .tab-drag-placeholder")].pop();
  if (lastNonUtil && lastNonUtil !== tabDragState.placeholder) {
    lastNonUtil.after(tabDragState.placeholder);
  }

  const SCROLL_ZONE = 40;
  if (clientX - barRect.left < SCROLL_ZONE) {
    bar.scrollLeft -= 10;
  } else if (barRect.right - clientX < SCROLL_ZONE) {
    bar.scrollLeft += 10;
  }
}

function onTabDragEnd(e) {
  if (!tabDragState) return;
  const { btn, tab, placeholder, bar, moved, isTouch } = tabDragState;

  if (isTouch) {
    document.removeEventListener("touchmove", onTabDragMove, { capture: true });
    document.removeEventListener("touchend", onTabDragEnd, { capture: true });
  } else {
    document.removeEventListener("mousemove", onTabDragMove, { capture: true });
    document.removeEventListener("mouseup", onTabDragEnd, { capture: true });
  }

  if (!moved && panelBottom) {
    btn.classList.remove("tab-dragging");
    btn.style.position = "";
    btn.style.top = "";
    btn.style.left = "";
    btn.style.width = "";
    btn.style.zIndex = "";
    placeholder.remove();
    tabDragState = null;
    const tabName = tabDisplayName(tab) || btn.textContent.replace("×", "").trim();
    if (confirm(`「${tabName}」を閉じますか？`)) {
      removeTab(tab.id);
    }
    return;
  }

  if (moved) {
    const ordered = Array.from(bar.querySelectorAll(".tab-btn:not(.tab-dragging):not(.tab-add-btn):not(.split-toggle-btn), .tab-drag-placeholder"));
    const pickerTab = tabs.find((t) => t.type === "picker");
    const nonPicker = [];
    for (const el of ordered) {
      if (el === placeholder) {
        nonPicker.push(tab);
        continue;
      }
      const tabId = el.dataset.tab;
      if (!tabId) continue;
      const t = tabs.find((t) => t.id === tabId);
      if (t && t.type !== "picker") nonPicker.push(t);
    }
    tabs = pickerTab ? [...nonPicker, pickerTab] : [...nonPicker];
  }

  btn.classList.remove("tab-dragging");
  btn.style.position = "";
  btn.style.top = "";
  btn.style.left = "";
  btn.style.width = "";
  btn.style.zIndex = "";
  placeholder.remove();
  tabDragState = null;
  renderTabBar();
}

function renderTabBar() {
  if (tabDragState) return;
  const barRow = $("tab-bar").parentNode;
  if (splitMode) {
    barRow.style.display = "none";
    $("header-row2").style.display = "none";
    return;
  }
  barRow.style.display = "flex";
  const bar = $("tab-bar");

  const pickerTab = tabs.find((t) => t.type === "picker");
  const nonPickerTabs = tabs.filter((t) => t.type !== "picker");
  const items = nonPickerTabs.map((tab, i) => ({ type: "tab", tab, index: i }));
  for (const s of orphanSessions) {
    items.push({ type: "orphan", orphan: s, index: s.tabIndex != null ? s.tabIndex : items.length });
  }
  items.sort((a, b) => a.index - b.index);

  let html = "";
  for (const item of items) {
    if (item.type === "tab") {
      const tab = item.tab;
      const tabIconHtml = renderTabIconHtml(tab);
      const actCls = tab._activity ? " tab-activity" : "";
      const activeCls = activeTabId === tab.id ? " active" : "";
      const suffix = panelBottom ? "" : `${escapeHtml(tab.label)}<span class="tab-close" data-close="${tab.id}">&times;</span>`;
      html += `<button class="tab-btn${activeCls}${actCls}" data-tab="${tab.id}">${tabIconHtml}${suffix}</button>`;
    } else {
      const s = item.orphan;
      const label = s.workspace || "terminal";
      const ows = s.workspace ? allWorkspaces.find((w) => w.name === s.workspace) : null;
      const owsIconHtml = ows && ows.icon ? renderIcon(ows.icon, ows.icon_color, 14) : "";
      const isDuplicateIcon = ows && ows.icon && s.icon === ows.icon;
      const orphanIcon = isDuplicateIcon ? "" : renderIcon(s.icon || "mdi-console", s.iconColor || "", 14);
      const suffix = panelBottom ? "" : `${escapeHtml(label)}<span class="tab-close" data-close-orphan="${escapeHtml(s.wsUrl)}">&times;</span>`;
      html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.wsUrl)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" title="他デバイスのセッション">${owsIconHtml}${orphanIcon}${suffix}</button>`;
    }
  }
  if (pickerTab && activeTabId === pickerTab.id) {
    html += `<button class="tab-btn tab-add-btn active" data-tab="${pickerTab.id}">`
      + `<span class="mdi mdi-plus"></span>`
      + `</button>`;
  } else {
    html += `<button class="tab-btn tab-add-btn" data-action="add-tab">`
      + `<span class="mdi mdi-plus"></span>`
      + `</button>`;
  }
  bar.innerHTML = html;

  bar.querySelectorAll(".tab-btn[data-action='add-tab']").forEach((btn) => {
    btn.addEventListener("click", () => showTerminalWsPicker());
  });
  bar.querySelectorAll(".tab-btn:not(.orphan):not([data-action])").forEach((btn) => {
    const tab = tabs.find((t) => t.id === btn.dataset.tab);
    if (btn.dataset.tab === "picker") {
      btn.addEventListener("click", () => showTerminalWsPicker());
      return;
    }
    bindLongPress(btn, {
      onLongPress: () => {
        openTabEditModal();
      },
      onClick: (e) => {
        if (e.target.classList.contains("tab-close")) return;
        const tabId = btn.dataset.tab;
        if (tabId === activeTabId) {
          const t = tabs.find(t => t.id === tabId);
          if (t && t.type === "terminal") {
            const frame = $(`frame-${tabId}`);
            if (frame && frame.classList.contains("view-mode")) {
              exitTerminalCopyMode(tabId);
            } else if (isTouchDevice) {
              t.term.scrollToBottom();
              enterTerminalCopyMode(tabId);
            }
            return;
          }
        }
        switchTab(tabId);
      },
    });
    if (!isTouchDevice && tab) bindMouseDrag(btn, tab);
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openTabEditModal();
    });
  });
  bar.querySelectorAll(".tab-btn.orphan").forEach((btn) => {
    bindLongPress(btn, {
      onLongPress: () => {
        const label = btn.dataset.orphanWs || "terminal";
        if (confirm(`「${label}」を閉じますか？`)) {
          const wsUrl = btn.dataset.orphanUrl;
          const match = wsUrl.match(/\/terminal\/ws\/([^/]+)/);
          if (match) {
            apiFetch(`/terminal/sessions/${match[1]}`, { method: "DELETE" }).catch(() => {});
          }
          orphanSessions = orphanSessions.filter((s) => s.wsUrl !== wsUrl);
          renderTabBar();
        }
      },
      onClick: (e) => {
        if (e.target.classList.contains("tab-close")) return;
        joinOrphanSession(btn.dataset.orphanUrl, btn.dataset.orphanWs);
      },
    });
  });
  bar.querySelectorAll(".tab-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.close) {
        removeTab(btn.dataset.close);
      } else if (btn.dataset.closeOrphan) {
        const wsUrl = btn.dataset.closeOrphan;
        const label = orphanSessions.find((s) => s.wsUrl === wsUrl)?.workspace || "terminal";
        if (!confirm(`「${label}」を閉じますか？`)) return;
        const match = wsUrl.match(/\/terminal\/ws\/([^/]+)/);
        if (match) {
          apiFetch(`/terminal/sessions/${match[1]}`, { method: "DELETE" }).catch(() => {});
        }
        orphanSessions = orphanSessions.filter((s) => s.wsUrl !== wsUrl);
        renderTabBar();
      }
    });
  });
  const activeBtn = bar.querySelector(".tab-btn.active");
  if (activeBtn) activeBtn.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function showTerminalWsPicker() {
  const existing = tabs.find((t) => t.type === "picker");
  if (existing) {
    switchTab(existing.id);
    return;
  }
  addPickerTab();
}

function ensurePickerTab() {
  const existing = tabs.find((t) => t.type === "picker");
  if (!existing) addPickerTab();
}

function renderPickerWsList(container) {
  const workspaces = visibleWorkspaces();
  for (const ws of workspaces) {
    const group = document.createElement("div");
    group.className = "picker-ws-group";

    const header = document.createElement("div");
    header.className = "picker-ws-header";
    const headerLabel = document.createElement("button");
    headerLabel.type = "button";
    headerLabel.className = "picker-ws-header-label";
    headerLabel.innerHTML = renderIcon(ws.icon || "mdi-console", ws.icon_color, 16) + " " + escapeHtml(ws.name);
    headerLabel.addEventListener("click", () => {
      resetPickerView();
      runJob("terminal", null, ws.name);
    });
    header.appendChild(headerLabel);

    const fileBtn = document.createElement("button");
    fileBtn.type = "button";
    fileBtn.className = "picker-ws-icon-btn picker-ws-file-btn";
    fileBtn.title = "ファイル一覧";
    fileBtn.innerHTML = renderIcon("mdi-folder", "", 18);
    fileBtn.addEventListener("click", () => {
      resetPickerView();
      selectedWorkspace = ws.name;
      openFileBrowser();
    });
    header.insertBefore(fileBtn, headerLabel);

    const icons = document.createElement("div");
    icons.className = "picker-ws-icons";
    header.appendChild(icons);

    group.appendChild(header);
    container.appendChild(group);

    loadPickerWsIcons(icons, ws);
  }
}

function addPickerTab() {
  const id = "picker";
  const container = document.createElement("div");
  container.className = "picker-frame";
  container.id = `frame-${id}`;
  container.style.display = "none";

  const topBar = document.createElement("div");
  topBar.className = "picker-top-bar";
  const topTitle = document.createElement("button");
  topTitle.type = "button";
  topTitle.className = "picker-top-title";
  topTitle.id = "picker-top-title";
  topTitle.textContent = "ワークスペースを開く";
  topTitle.addEventListener("click", () => {
    const settingsView = $("picker-settings-view");
    if (!settingsView || settingsView.style.display === "none") return;
    if ($("picker-top-title").dataset.level === "sub") {
      $("picker-top-title").textContent = "設定";
      $("picker-top-title").dataset.level = "menu";
      renderPickerSettingsMenu(settingsView);
    } else {
      showPickerMainView();
    }
  });
  topBar.appendChild(topTitle);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "picker-close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.style.display = "none";
  closeBtn.addEventListener("click", () => {
    showPickerMainView();
  });
  topBar.appendChild(closeBtn);
  container.appendChild(topBar);

  const mainView = document.createElement("div");
  mainView.className = "picker-main-view";
  mainView.id = "picker-main-view";

  const list = document.createElement("div");
  list.className = "terminal-ws-list";
  renderPickerWsList(list);

  mainView.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "menu-footer-row";
  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "menu-footer-btn";
  settingsBtn.innerHTML = '<span class="mdi mdi-cog"></span> 設定';
  settingsBtn.addEventListener("click", () => showPickerSettings());
  footer.appendChild(settingsBtn);
  mainView.appendChild(footer);

  const serverInfo = document.createElement("div");
  serverInfo.className = "picker-server-info";
  const parts = [serverHostname, serverVersion].filter(Boolean);
  serverInfo.textContent = parts.join(" / ");
  mainView.appendChild(serverInfo);

  container.appendChild(mainView);

  const settingsView = document.createElement("div");
  settingsView.className = "picker-settings-view";
  settingsView.id = "picker-settings-view";
  settingsView.style.display = "none";
  container.appendChild(settingsView);

  $("output-container").appendChild(container);
  tabs.push({ id, type: "picker", label: "開く" });
  switchTab(id);
}

function showPickerSettings() {
  const mainView = $("picker-main-view");
  const settingsView = $("picker-settings-view");
  if (!mainView || !settingsView) return;

  mainView.style.display = "none";
  settingsView.style.display = "";
  const closeBtn = mainView.parentNode.querySelector(".picker-close-btn");
  if (closeBtn) closeBtn.style.display = "";
  renderPickerSettingsMenu(settingsView);
}

function showPickerMainView() {
  const mainView = $("picker-main-view");
  const settingsView = $("picker-settings-view");
  const title = $("picker-top-title");
  if (!mainView || !settingsView) return;

  settingsView.style.display = "none";
  mainView.style.display = "";
  title.textContent = "ワークスペースを開く";
  title.dataset.level = "";
  const closeBtn = mainView.parentNode.querySelector(".picker-close-btn");
  if (closeBtn) closeBtn.style.display = "none";
}

function renderPickerSettingsMenu(container) {
  container.innerHTML = "";
  $("picker-top-title").innerHTML = '<span class="mdi mdi-arrow-left"></span> 設定';
  $("picker-top-title").dataset.level = "menu";
  const menu = document.createElement("div");
  menu.className = "settings-menu";

  const items = [
    { icon: "mdi-cog", label: "ワークスペース設定", action: () => showPickerWsVisibility(container) },
    { icon: "mdi-plus", label: "ワークスペース追加", action: () => showPickerClone(container) },
    { icon: "mdi-download", label: "設定エクスポート", action: () => exportSettings() },
    { icon: "mdi-upload", label: "設定インポート", action: () => importSettings() },
    { icon: "mdi-format-list-bulleted", label: "プロセス一覧", action: () => showPickerProcessList(container) },
    { icon: "mdi-information-outline", label: "サーバー情報", action: () => showPickerServerInfo(container) },
    { icon: "mdi-text-box-outline", label: "操作ログ", action: () => showPickerOpLog(container) },
  ];

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-menu-item";
    btn.innerHTML = `<span class="mdi ${item.icon}"></span> ${item.label}`;
    btn.addEventListener("click", item.action);
    menu.appendChild(btn);
  }

  container.appendChild(menu);
}

function showPickerSettingsSubView(container, title, renderContent) {
  container.innerHTML = "";
  $("picker-top-title").innerHTML = '<span class="mdi mdi-arrow-left"></span> ' + escapeHtml(title);
  $("picker-top-title").dataset.level = "sub";

  const content = document.createElement("div");
  content.className = "picker-settings-content";
  container.appendChild(content);

  renderContent(content);
}

function showPickerWsVisibility(container) {
  showPickerSettingsSubView(container, "ワークスペース設定", (content) => {
    const list = document.createElement("div");
    list.className = "ws-check-list";
    list.style.overflow = "auto";
    list.style.flex = "1";

    renderWsVisibilityTo(
      list,
      (ws) => {
        selectedWorkspace = ws.name;
        openItemCreateModal(ws.name, "job", "picker-settings");
      },
      loadPickerSettingsWsIcons,
    );
    content.appendChild(list);
  });
}

function loadPickerSettingsWsIcons(container, ws) {
  loadWsIconButtons(container, ws, 16,
    (link, i) => {
      openItemEditModal("link", {
        workspace: ws.name, index: i,
        label: link.label || link.url,
        url: link.url,
        icon: link.icon,
        iconColor: link.icon_color,
      }, "picker-settings");
    },
    (name, job) => {
      openItemEditModal("job", {
        workspace: ws.name,
        name,
        label: job.label || name,
        icon: job.icon,
        iconColor: job.icon_color,
        command: job.command || "",
        confirm: job.confirm,
      }, "picker-settings");
    },
  );
}

function showPickerSubViewWithList(container, title, renderFn) {
  showPickerSettingsSubView(container, title, async (content) => {
    const list = document.createElement("div");
    list.className = "server-info-list";
    content.appendChild(list);
    await renderFn(list);
  });
}

async function showPickerServerInfo(container) {
  showPickerSubViewWithList(container, "サーバー情報", renderServerInfoTo);
}

async function showPickerProcessList(container) {
  showPickerSubViewWithList(container, "プロセス一覧", renderProcessListTo);
}

async function showPickerOpLog(container) {
  showPickerSubViewWithList(container, "操作ログ", renderOpLogTo);
}

function showPickerClone(container) {
  showPickerSettingsSubView(container, "ワークスペース追加", (content) => {
    let pickerCloneTab = "github";
    let pickerSelectedUrl = "";
    let pickerRepos = [];

    const tabs = document.createElement("div");
    tabs.className = "clone-tabs";
    const githubBtn = document.createElement("button");
    githubBtn.type = "button";
    githubBtn.className = "clone-tab active";
    githubBtn.textContent = "GitHub";
    const urlBtn = document.createElement("button");
    urlBtn.type = "button";
    urlBtn.className = "clone-tab";
    urlBtn.textContent = "手動入力";
    tabs.append(githubBtn, urlBtn);
    content.appendChild(tabs);

    const githubPane = document.createElement("div");
    githubPane.className = "clone-tab-content";
    const repoList = document.createElement("div");
    repoList.className = "clone-repo-list";
    repoList.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
    githubPane.appendChild(repoList);
    content.appendChild(githubPane);

    const urlPane = document.createElement("div");
    urlPane.className = "clone-tab-content";
    urlPane.style.display = "none";
    const urlGroup = document.createElement("div");
    urlGroup.className = "form-group";
    urlGroup.innerHTML = '<label class="form-label">リポジトリ</label>';
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "form-input";
    urlInput.placeholder = "git@github.com:user/repo.git or https://...";
    urlInput.autocomplete = "off";
    urlGroup.appendChild(urlInput);
    urlPane.appendChild(urlGroup);
    content.appendChild(urlPane);

    const nameGroup = document.createElement("div");
    nameGroup.className = "form-group";
    nameGroup.innerHTML = '<label class="form-label">ディレクトリ名 <span class="form-hint">(省略時はリポジトリ名)</span></label>';
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-input";
    nameInput.autocomplete = "off";
    nameGroup.appendChild(nameInput);
    content.appendChild(nameGroup);

    const errorEl = document.createElement("div");
    errorEl.className = "form-error";
    content.appendChild(errorEl);

    const outputEl = document.createElement("div");
    outputEl.className = "clone-output";
    outputEl.style.display = "none";
    content.appendChild(outputEl);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "primary";
    submitBtn.style.width = "auto";
    submitBtn.textContent = "クローン";
    actions.appendChild(submitBtn);
    content.appendChild(actions);

    function switchTab(tab) {
      pickerCloneTab = tab;
      githubBtn.classList.toggle("active", tab === "github");
      urlBtn.classList.toggle("active", tab === "url");
      githubPane.style.display = tab === "github" ? "block" : "none";
      urlPane.style.display = tab === "url" ? "block" : "none";
      if (tab === "url") urlInput.focus();
    }

    githubBtn.addEventListener("click", () => switchTab("github"));
    urlBtn.addEventListener("click", () => switchTab("url"));

    function renderRepos() {
      if (pickerRepos.length === 0) {
        repoList.innerHTML = '<div class="clone-repo-empty">リポジトリがありません</div>';
        return;
      }
      repoList.innerHTML = "";
      for (const repo of pickerRepos) {
        const item = document.createElement("div");
        item.className = "clone-repo-item" + (pickerSelectedUrl === repo.url ? " selected" : "");
        item.innerHTML = `<div class="clone-repo-name">${escapeHtml(repo.nameWithOwner)}</div>` +
          (repo.description ? `<div class="clone-repo-desc">${escapeHtml(repo.description)}</div>` : "");
        item.addEventListener("click", () => {
          pickerSelectedUrl = repo.url;
          renderRepos();
        });
        repoList.appendChild(item);
      }
    }

    async function loadRepos() {
      repoList.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
      try {
        const res = await apiFetch("/github/repos");
        if (!res) return;
        if (!res.ok) {
          const data = await res.json();
          repoList.innerHTML = `<div class="clone-repo-error">${escapeHtml(data.detail || "取得に失敗しました")}</div>`;
          return;
        }
        pickerRepos = await res.json();
        renderRepos();
      } catch (e) {
        repoList.innerHTML = `<div class="clone-repo-error">${escapeHtml(e.message)}</div>`;
      }
    }

    submitBtn.addEventListener("click", async () => {
      let url = pickerCloneTab === "github" ? pickerSelectedUrl : urlInput.value.trim();
      url = toSshUrl(url);
      const name = nameInput.value.trim();

      if (!url) {
        errorEl.textContent = pickerCloneTab === "github" ? "リポジトリを選択してください" : "URLを入力してください";
        errorEl.style.display = "block";
        return;
      }

      errorEl.style.display = "none";
      outputEl.style.display = "block";
      outputEl.textContent = "cloning...";
      submitBtn.disabled = true;

      try {
        const res = await apiFetch("/workspaces", {
          method: "POST",
          body: { url, name: name || null },
        });
        if (!res) return;
        const data = await res.json();
        if (!res.ok || data.status === "error") {
          errorEl.textContent = data.detail || data.stderr || "クローンに失敗しました";
          errorEl.style.display = "block";
          outputEl.style.display = "none";
          submitBtn.disabled = false;
          return;
        }
        outputEl.textContent = `${data.name} をクローンしました`;
        await loadWorkspaces();
        showPickerWsVisibility(container);
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = "block";
        outputEl.style.display = "none";
        submitBtn.disabled = false;
      }
    });

    loadRepos();
  });
}

function loadPickerWsIcons(container, ws) {
  loadWsIconButtons(container, ws, 18,
    (link) => {
      window.open(link.url, "_blank");
    },
    (name, job) => {
      if (job.confirm !== false) {
        if (!confirm(`${job.label || name} を実行しますか？`)) return;
      }
      resetPickerView();
      runJob(name, null, ws.name);
    },
  );
}

function refreshPickerContent() {
  const mainView = $("picker-main-view");
  if (!mainView) return;
  const list = mainView.querySelector(".terminal-ws-list");
  if (!list) return;
  list.innerHTML = "";
  renderPickerWsList(list);
}

function resetPickerView() {
  const mainView = $("picker-main-view");
  const settingsView = $("picker-settings-view");
  const title = $("picker-top-title");
  if (mainView) mainView.style.display = "";
  if (settingsView) settingsView.style.display = "none";
  if (title) title.textContent = "ワークスペースを開く";
}

function insertBeforePicker(tab) {
  const pickerIdx = tabs.findIndex((t) => t.type === "picker");
  if (pickerIdx >= 0) {
    tabs.splice(pickerIdx, 0, tab);
  } else {
    tabs.push(tab);
  }
}

const XTERM_PALETTE = (() => {
  const base = [
    "#000000","#cc0000","#4e9a06","#c4a000","#3465a4","#75507b","#06989a","#d3d7cf",
    "#555753","#ef2929","#8ae234","#fce94f","#729fcf","#ad7fa8","#34e2e2","#eeeeec",
  ];
  const cube = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++)
        base.push(`#${cube[r].toString(16).padStart(2,"0")}${cube[g].toString(16).padStart(2,"0")}${cube[b].toString(16).padStart(2,"0")}`);
  for (let i = 0; i < 24; i++) {
    const v = (8 + i * 10).toString(16).padStart(2, "0");
    base.push(`#${v}${v}${v}`);
  }
  return base;
})();

function xtermCellColor(cell, isFg) {
  const isPalette = isFg ? cell.isFgPalette() : cell.isBgPalette();
  const isRGB = isFg ? cell.isFgRGB() : cell.isBgRGB();
  const color = isFg ? cell.getFgColor() : cell.getBgColor();
  if (isPalette) return XTERM_PALETTE[color] || null;
  if (isRGB) return `#${color.toString(16).padStart(6, "0")}`;
  return null;
}

function terminalBufferToHtml(term) {
  const buf = term.buffer.active;
  const lines = [];
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) { lines.push(""); continue; }
    let html = "";
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell) continue;
      const ch = cell.getChars();
      if (cell.getWidth() === 0 && !ch) continue;
      const fg = xtermCellColor(cell, true);
      const bg = xtermCellColor(cell, false);
      const bold = cell.isBold();
      const dim = cell.isDim();
      const italic = cell.isItalic();
      const underline = cell.isUnderline();
      const strikethrough = cell.isStrikethrough();
      const needsSpan = fg || bg || bold || dim || italic || underline || strikethrough;
      if (needsSpan) {
        let style = "";
        if (fg) style += `color:${fg};`;
        if (bg) style += `background:${bg};`;
        if (bold) style += "font-weight:bold;";
        if (dim) style += "opacity:0.5;";
        if (italic) style += "font-style:italic;";
        if (underline) style += "text-decoration:underline;";
        if (strikethrough) style += "text-decoration:line-through;";
        html += `<span style="${style}">`;
      }
      html += ch ? escapeHtml(ch) : " ";
      if (needsSpan) html += "</span>";
    }
    lines.push(html);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

function enterTerminalCopyMode(tabId) {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || tab.type !== "terminal") return;
  const container = $(`frame-${tabId}`);
  if (!container || container.classList.contains("view-mode")) return;

  container.classList.add("view-mode");

  const wrapper = $("keyboard-input");
  if (wrapper) {
    const kbWrapper = wrapper.closest(".keyboard-input-wrapper");
    if (kbWrapper) kbWrapper.style.display = "none";
  }

  const overlay = document.createElement("div");
  overlay.className = "view-mode-overlay";
  const label = document.createElement("div");
  label.className = "view-mode-label";

  const info = document.createElement("span");
  info.className = "view-mode-label-info";
  info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tab.label || "") + " 閲覧モード";
  label.appendChild(info);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "view-mode-close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => exitTerminalCopyMode(tabId));
  label.appendChild(closeBtn);
  overlay.appendChild(label);
  container.appendChild(overlay);

  const pre = document.createElement("pre");
  pre.className = "view-mode-textarea";
  pre.innerHTML = terminalBufferToHtml(tab.term);
  container.appendChild(pre);
  pre.scrollTop = pre.scrollHeight;
}

function exitTerminalCopyMode(tabId) {
  const container = $(`frame-${tabId}`);
  if (!container) return;
  container.classList.remove("view-mode");
  const overlay = container.querySelector(".view-mode-overlay");
  if (overlay) overlay.remove();
  const pre = container.querySelector(".view-mode-textarea");
  if (pre) pre.remove();
}

function getNonPickerTabs() {
  return tabs.filter((t) => t.type !== "picker");
}

function calcGridLayout(count) {
  if (count <= 4) return [count];
  const topRow = Math.ceil(count / 2);
  return [topRow, count - topRow];
}

function enterSplitMode() {
  const nonPicker = getNonPickerTabs();
  if (nonPicker.length < 2) return;
  if (splitMode) return;

  splitMode = true;
  for (const t of nonPicker) {
    if (t.type === "terminal") exitTerminalCopyMode(t.id);
  }
  splitPaneTabIds = nonPicker.map((t) => t.id);
  const activeIdx = splitPaneTabIds.indexOf(activeTabId);
  activePaneIndex = activeIdx >= 0 ? activeIdx : 0;
  activeTabId = splitPaneTabIds[activePaneIndex];

  buildSplitDom();
  fitAllSplitTerminals();
  renderTabBar();
}

function openTabEditModal() {
  let overlay = document.getElementById("split-tab-modal-overlay");
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.id = "split-tab-modal-overlay";
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal split-tab-modal";

  const header = document.createElement("div");
  header.className = "split-tab-modal-header";
  const title = document.createElement("h3");
  title.textContent = "タブ編集";
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "split-tab-modal-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => closeModal());
  header.appendChild(closeBtn);

  modal.appendChild(header);

  const canSplit = getNonPickerTabs().length >= 2;
  let radioNormal, radioSplit;
  if (canSplit) {
    const modeRow = document.createElement("div");
    modeRow.className = "split-tab-mode-row";

    radioNormal = document.createElement("button");
    radioNormal.type = "button";
    radioSplit = document.createElement("button");
    radioSplit.type = "button";

    radioNormal.textContent = "通常";
    radioSplit.textContent = "分割";

    updateModeRadio();

    radioNormal.addEventListener("click", () => {
      if (splitMode) { exitSplitMode(); updateModeRadio(); renderTabList(); }
    });
    radioSplit.addEventListener("click", () => {
      if (!splitMode) { enterSplitMode(); updateModeRadio(); renderTabList(); }
    });

    modeRow.appendChild(radioNormal);
    modeRow.appendChild(radioSplit);
    modal.appendChild(modeRow);
  }

  function updateModeRadio() {
    if (!radioNormal) return;
    radioNormal.className = "split-tab-mode-option" + (splitMode ? "" : " active");
    radioSplit.className = "split-tab-mode-option" + (splitMode ? " active" : "");
  }

  const list = document.createElement("div");
  list.className = "split-tab-list";
  modal.appendChild(list);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  renderTabList();

  let dragState = null;

  function toggleRow(tab) {
    if (splitMode) {
      const included = splitPaneTabIds.includes(tab.id);
      if (included) {
        if (splitPaneTabIds.length <= 2) return;
        splitPaneTabIds = splitPaneTabIds.filter((id) => id !== tab.id);
        const frame = $(`frame-${tab.id}`);
        if (frame) frame.style.display = "none";
      } else {
        splitPaneTabIds.push(tab.id);
      }
      if (activePaneIndex >= splitPaneTabIds.length) activePaneIndex = 0;
      activeTabId = splitPaneTabIds[activePaneIndex];
      const container = $("output-container");
      clearSplitDom(container);
      container.classList.remove("split-active", "split-mobile");
      buildSplitDom();
      fitAllSplitTerminals();
      renderTabList();
    } else {
      switchTab(tab.id);
      renderTabList();
    }
  }

  function renderTabList() {
    list.innerHTML = "";
    const nonPicker = tabs.filter((t) => t.type !== "picker");
    for (let i = 0; i < nonPicker.length; i++) {
      const tab = nonPicker[i];

      const row = document.createElement("div");
      row.className = "split-tab-row";
      row.dataset.idx = i;
      if (!splitMode && tab.id === activeTabId) row.classList.add("active");

      const inputWrap = document.createElement("span");
      inputWrap.className = "split-tab-input-wrap";
      if (splitMode) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "split-tab-input";
        checkbox.checked = splitPaneTabIds.includes(tab.id);
        checkbox.disabled = true;
        inputWrap.appendChild(checkbox);
      } else {
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.className = "split-tab-input";
        radio.checked = tab.id === activeTabId;
        radio.disabled = true;
        inputWrap.appendChild(radio);
      }
      row.appendChild(inputWrap);

      const handle = document.createElement("span");
      handle.className = "split-tab-drag-handle";
      handle.innerHTML = '<span class="mdi mdi-drag"></span>';
      bindDragHandle(handle, row, i);
      row.appendChild(handle);

      const info = document.createElement("span");
      info.className = "split-tab-row-info";
      info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tabDisplayName(tab) || tab.label || "");
      row.appendChild(info);

      row.addEventListener("click", (e) => {
        if (e.target.closest(".split-tab-drag-handle")) return;
        if (e.target.closest(".split-tab-close-btn")) return;
        toggleRow(tab);
      });

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "split-tab-close-btn";
      closeBtn.innerHTML = "&times;";
      closeBtn.addEventListener("click", () => {
        removeTab(tab.id);
        renderTabList();
      });
      row.appendChild(closeBtn);

      list.appendChild(row);
    }
  }

  function bindDragHandle(handle, row, idx) {
    function onStart(e) {
      e.preventDefault();
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const rowRect = row.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      dragState = { idx, startY: y, offsetY: y - rowRect.top, rowHeight: rowRect.height };
      row.classList.add("dragging");
      row.style.position = "relative";
      row.style.zIndex = "10";

      function onMove(ev) {
        if (!dragState) return;
        const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
        const dy = cy - dragState.startY;
        row.style.transform = `translateY(${dy}px)`;

        const currentListRect = list.getBoundingClientRect();
        const relY = cy - currentListRect.top;
        let targetIdx = Math.floor(relY / dragState.rowHeight);
        targetIdx = Math.max(0, Math.min(targetIdx, list.children.length - 1));

        if (targetIdx !== dragState.idx) {
          moveTab(dragState.idx, targetIdx);
          dragState.idx = targetIdx;
          dragState.startY = cy;
          row.style.transform = "";
        }
      }

      function onEnd() {
        if (!dragState) return;
        row.classList.remove("dragging");
        row.style.position = "";
        row.style.zIndex = "";
        row.style.transform = "";
        dragState = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onEnd);
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", onEnd);
        applyTabOrder();
        renderTabList();
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
    }

    handle.addEventListener("mousedown", onStart);
    handle.addEventListener("touchstart", onStart, { passive: false });
  }

  function moveTab(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const rows = Array.from(list.children);
    const row = rows[fromIdx];
    if (toIdx > fromIdx) {
      list.insertBefore(row, rows[toIdx].nextSibling);
    } else {
      list.insertBefore(row, rows[toIdx]);
    }
  }

  function applyTabOrder() {
    const nonPicker = tabs.filter((t) => t.type !== "picker");
    const rows = Array.from(list.children);
    const newOrder = rows.map((r) => nonPicker[parseInt(r.dataset.idx)]).filter(Boolean);

    const picker = tabs.find((t) => t.type === "picker");
    const reordered = newOrder.slice();
    if (picker) reordered.push(picker);
    tabs.length = 0;
    tabs.push(...reordered);

    if (splitMode) {
      splitPaneTabIds = newOrder.map((t) => t.id);
      activePaneIndex = splitPaneTabIds.indexOf(activeTabId);
      rebuildSplitLayout();
    } else {
      renderTabBar();
    }
  }

  function closeModal() {
    overlay.remove();
  }
}

function exitSplitMode() {
  exitSplitModeWithTab(activeTabId);
}

function exitSplitModeWithTab(targetTabId) {
  if (!splitMode) return;

  const container = $("output-container");
  clearSplitDom(container);
  container.classList.remove("split-active", "split-mobile");

  splitMode = false;
  splitPaneTabIds = [];
  activePaneIndex = 0;

  const target = tabs.find((t) => t.id === targetTabId) ? targetTabId : activeTabId;
  for (const tab of tabs) {
    const el = $(`frame-${tab.id}`);
    if (el) {
      el.style.display = tab.id === target ? (tab.type === "terminal" ? "block" : "") : "none";
    }
  }

  switchTab(target);
}

function rebuildSplitLayout() {
  if (!splitMode) return;
  blurAllTerminals();
  const container = $("output-container");
  clearSplitDom(container);
  container.classList.remove("split-active", "split-mobile");

  const nonPicker = getNonPickerTabs();
  if (nonPicker.length < 2) {
    exitSplitMode();
    return;
  }

  const nonPickerIds = new Set(nonPicker.map((t) => t.id));
  const kept = splitPaneTabIds.filter((id) => nonPickerIds.has(id));
  const added = nonPicker.filter((t) => !splitPaneTabIds.includes(t.id)).map((t) => t.id);
  splitPaneTabIds = [...kept, ...added];

  if (activePaneIndex >= splitPaneTabIds.length) {
    activePaneIndex = 0;
  }
  activeTabId = splitPaneTabIds[activePaneIndex];

  buildSplitDom();
  fitAllSplitTerminals();
}

function clearSplitDom(container) {
  const rows = container.querySelectorAll(".split-row");
  rows.forEach((row) => {
    const panes = row.querySelectorAll(".split-pane");
    panes.forEach((pane) => {
      while (pane.firstChild) {
        if (pane.firstChild.classList && pane.firstChild.classList.contains("split-pane-label")) {
          pane.firstChild.remove();
        } else {
          container.appendChild(pane.firstChild);
        }
      }
      pane.remove();
    });
    row.remove();
  });
  const directPanes = container.querySelectorAll(":scope > .split-pane");
  directPanes.forEach((pane) => {
    while (pane.firstChild) {
      if (pane.firstChild.classList && pane.firstChild.classList.contains("split-pane-label")) {
        pane.firstChild.remove();
      } else {
        container.appendChild(pane.firstChild);
      }
    }
    pane.remove();
  });
}

function blurAllTerminals() {
  for (const t of tabs) {
    if (t.type === "terminal" && t.term) {
      t.term.blur();
      t.term.clearSelection();
    }
  }
}

function buildSplitDom() {
  blurAllTerminals();
  const container = $("output-container");
  container.classList.add("split-active");

  if (panelBottom) {
    container.classList.add("split-mobile");
    for (let i = 0; i < splitPaneTabIds.length; i++) {
      container.appendChild(createSplitPane(i));
    }
  } else {
    const rows = calcGridLayout(splitPaneTabIds.length);
    let paneIdx = 0;
    for (const rowCount of rows) {
      const row = document.createElement("div");
      row.className = "split-row";
      for (let j = 0; j < rowCount; j++) {
        row.appendChild(createSplitPane(paneIdx));
        paneIdx++;
      }
      container.appendChild(row);
    }
  }

  updatePaneLabels();
  updateActivePaneVisual();
}

function createSplitPane(index) {
  const pane = document.createElement("div");
  pane.className = `split-pane pane-${index}`;
  if (index === activePaneIndex) pane.classList.add("active-pane");

  const tabId = splitPaneTabIds[index];
  const frame = $(`frame-${tabId}`);
  const tab = tabs.find((t) => t.id === tabId);
  if (frame && tab) {
    pane.appendChild(frame);
    frame.style.display = tab.type === "terminal" ? "block" : "";
  }

  pane.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".split-pane-label")) return;
    if (activePaneIndex === index) {
      if (isTouchDevice) showKeyboardInput();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    setActivePaneIndex(index);
  }, true);

  return pane;
}

function setActivePaneIndex(index) {
  activePaneIndex = index;
  activeTabId = splitPaneTabIds[index];
  updateActivePaneVisual();
}

function updateActivePaneVisual() {
  const container = $("output-container");
  container.querySelectorAll(".split-pane").forEach((pane, i) => {
    pane.classList.toggle("active-pane", i === activePaneIndex);
  });
}

function updatePaneLabels() {
  const container = $("output-container");
  if (!container || !splitMode) return;
  const panes = container.querySelectorAll(".split-pane");
  panes.forEach((pane, i) => {
    const old = pane.querySelector(".split-pane-label");
    if (old) old.remove();

    const tabId = splitPaneTabIds[i];
    const tab = tabId ? tabs.find((t) => t.id === tabId) : null;
    if (!tab) return;

    const label = document.createElement("div");
    label.className = "split-pane-label";

    const info = document.createElement("span");
    info.className = "split-pane-label-info";
    info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tab.label || "");
    label.appendChild(info);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "split-pane-close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "分割から外す";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (splitPaneTabIds.length <= 2) {
        exitSplitModeWithTab(splitPaneTabIds.find((id) => id !== tabId) || tabId);
        return;
      }
      splitPaneTabIds = splitPaneTabIds.filter((id) => id !== tabId);
      const frame = $(`frame-${tabId}`);
      if (frame) frame.style.display = "none";
      if (activePaneIndex >= splitPaneTabIds.length) activePaneIndex = 0;
      activeTabId = splitPaneTabIds[activePaneIndex];
      const container = $("output-container");
      clearSplitDom(container);
      container.classList.remove("split-active", "split-mobile");
      buildSplitDom();
      fitAllSplitTerminals();
    });
    label.appendChild(closeBtn);

    label.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      exitSplitModeWithTab(tabId);
    });

    bindLongPress(label, {
      onLongPress: () => {
        openTabEditModal();
      },
      onClick: () => {
        if (splitPaneTabIds[activePaneIndex] === tabId) {
          if (isTouchDevice) showKeyboardInput();
        } else {
          const idx = splitPaneTabIds.indexOf(tabId);
          if (idx >= 0) setActivePaneIndex(idx);
        }
      },
    });

    label.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openTabEditModal();
    });

    pane.appendChild(label);
  });
}

function fitAllSplitTerminals() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const tabId of splitPaneTabIds) {
        const tab = tabs.find((t) => t.id === tabId);
        if (tab && tab.type === "terminal") {
          tab.term.clearSelection();
          fitAndSync(tab);
        }
      }
    });
  });
}

document.addEventListener("paste", (e) => {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return;
  e.preventDefault();
  e.stopPropagation();
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) uploadClipboardImage(file);
      return;
    }
  }
  const text = e.clipboardData.getData("text");
  if (text && activeTab.ws && activeTab.ws.readyState === WebSocket.OPEN) {
    const bracketedPaste = "\x1b[200~" + text + "\x1b[201~";
    activeTab.ws.send(new TextEncoder().encode(bracketedPaste));
  }
}, true);
