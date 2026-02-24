let sessionKeepaliveTimer = null;
let lastVisibleTime = Date.now();

const OSC_TITLE_RE = /\x1b\]0;/;

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
  } catch {
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
  const oldOrphans = new Map(orphanSessions.map((s) => [s.wsUrl, s]));
  orphanSessions = sessions
    .filter((s) => !localWsUrls.has(s.ws_url) && !closedSessionUrls.has(s.ws_url))
    .map((s, i) => {
      const old = oldOrphans.get(s.ws_url);
      return { wsUrl: s.ws_url, workspace: s.workspace, expiresIn: s.expires_in, icon: s.icon, iconColor: s.icon_color, tabIndex: old ? old.tabIndex : tabs.length + i };
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
  const wsIcon = ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : null;
  const insertIndex = orphan && orphan.tabIndex != null ? Math.min(orphan.tabIndex, tabs.length) : tabs.length;
  addTerminalTab(wsUrl, label, null, true, false, null, tabIcon, wsIcon);
  const tab = tabs.find((t) => t.wsUrl === wsUrl);
  if (tab) {
    tab._pendingRedraw = true;
    tabs.splice(tabs.indexOf(tab), 1);
    tabs.splice(insertIndex, 0, tab);
  }
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
    console.error("WebSocket error:", tab.wsUrl);
  };

  ws.onclose = (e) => {
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

function addTerminalTab(wsUrl, workspace, tabId, skipSwitch, restored, initialCommand, tabIcon, wsIcon, jobName) {
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

  container.addEventListener("touchend", () => {
    if (container.classList.contains("view-mode")) return;
    if (isTouchDevice) showKeyboardInput();
  });


  const tab = { id, type: "terminal", wsUrl, label, term, fitAddon, ws: null, _initialCommand: initialCommand || null, icon: tabIcon || null, wsIcon: wsIcon || null, jobName: jobName || null, _pendingOpen: !!restored, _pendingRedraw: !!restored };
  tabs.push(tab);
  movePickerToEnd();

  if (!restored) {
    term.open(container);
    connectTerminalWs(tab);
  }

  if (skipSwitch) return;
  saveTerminalTabs();
  switchTab(id);
}

function setOutputTab(id, label, htmlContent, icon, wsIcon, workspace) {
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
  tabs.push({ id, type: "output", label, icon: icon || null, wsIcon: wsIcon || null, workspace: workspace || null });
  movePickerToEnd();
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
  if (tab && tab.type === "terminal") {
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
  if (activeTabId === id) {
    switchTab(tabs.length > 0 ? tabs[tabs.length - 1].id : null);
  } else {
    renderTabBar();
  }
}

async function switchTab(id) {
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

  const switchedTabObj = tabs.find((t) => t.id === id);
  if (switchedTabObj && switchedTabObj.type === "picker") {
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

function renderTabBar() {
  const barRow = $("tab-bar").parentNode;
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
      const wsIconHtml = tab.wsIcon ? renderIcon(tab.wsIcon.name, tab.wsIcon.color, 14) : "";
      const iconHtml = tab.icon ? renderIcon(tab.icon.name, tab.icon.color, 14) : "";
      const actCls = tab._activity ? " tab-activity" : "";
      if (panelBottom) {
        html += `<button class="tab-btn${activeTabId === tab.id ? " active" : ""}${actCls}" data-tab="${tab.id}">`
          + `${wsIconHtml}${iconHtml}</button>`;
      } else {
        html += `<button class="tab-btn${activeTabId === tab.id ? " active" : ""}${actCls}" data-tab="${tab.id}">`
          + `${wsIconHtml}${iconHtml}${escapeHtml(tab.label)}<span class="tab-close" data-close="${tab.id}">&times;</span></button>`;
      }
    } else {
      const s = item.orphan;
      const label = s.workspace || "terminal";
      const orphanIcon = renderIcon(s.icon || "mdi-console", s.iconColor || "", 14);
      const ows = s.workspace ? allWorkspaces.find((w) => w.name === s.workspace) : null;
      const owsIconHtml = ows && ows.icon ? renderIcon(ows.icon, ows.icon_color, 14) : "";
      if (panelBottom) {
        html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.wsUrl)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" title="他デバイスのセッション">`
          + `${owsIconHtml}${orphanIcon}</button>`;
      } else {
        html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.wsUrl)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" title="他デバイスのセッション">`
          + `${owsIconHtml}${orphanIcon}${escapeHtml(label)}</button>`;
      }
    }
  }
  if (pickerTab) {
    html += `<button class="tab-btn${activeTabId === pickerTab.id ? " active" : ""}" data-tab="${pickerTab.id}">`
      + `<span class="mdi mdi-plus"></span>`
      + ""
      + `</button>`;
  }
  bar.innerHTML = html;

  bar.querySelectorAll(".tab-btn:not(.orphan)").forEach((btn) => {
    const tab = tabs.find((t) => t.id === btn.dataset.tab);
    if (tab && tab.type === "picker") {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
      return;
    }
    bindLongPress(btn, {
      onLongPress: () => {
        const tabName = tabDisplayName(tab) || btn.textContent.replace("×", "").trim();
        if (confirm(`「${tabName}」を閉じますか？`)) {
          removeTab(btn.dataset.tab);
        }
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
      onClick: () => joinOrphanSession(btn.dataset.orphanUrl, btn.dataset.orphanWs),
    });
  });
  bar.querySelectorAll(".tab-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tabId = btn.dataset.close;
      const tab = tabs.find((t) => t.id === tabId);
      const tabName = tabDisplayName(tab);
      if (tabName && !confirm(`「${tabName}」を閉じますか？`)) return;
      removeTab(tabId);
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
      renderWorkspaceSelects();
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
    { icon: "mdi-plus", label: "ワークスペース追加", action: () => openCloneModal() },
    { icon: "mdi-download", label: "設定エクスポート", action: () => exportSettings() },
    { icon: "mdi-upload", label: "設定インポート", action: () => importSettings() },
    { icon: "mdi-format-list-bulleted", label: "プロセス一覧", action: () => showPickerProcessList(container) },
    { icon: "mdi-information-outline", label: "サーバー情報", action: () => showPickerServerInfo(container) },
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

async function showPickerServerInfo(container) {
  showPickerSettingsSubView(container, "サーバー情報", async (content) => {
    const list = document.createElement("div");
    list.className = "server-info-list";
    content.appendChild(list);
    await renderServerInfoTo(list);
  });
}

async function showPickerProcessList(container) {
  showPickerSettingsSubView(container, "プロセス一覧", async (content) => {
    const list = document.createElement("div");
    list.className = "server-info-list";
    content.appendChild(list);
    await renderProcessListTo(list);
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

function movePickerToEnd() {
  const idx = tabs.findIndex((t) => t.type === "picker");
  if (idx >= 0 && idx < tabs.length - 1) {
    const [picker] = tabs.splice(idx, 1);
    tabs.push(picker);
  }
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
  const label = document.createElement("span");
  label.className = "view-mode-label";
  label.textContent = "閲覧モード";
  const closeBtn = document.createElement("button");
  closeBtn.className = "view-mode-close-btn";
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => exitTerminalCopyMode(tabId));
  overlay.append(label, closeBtn);
  container.appendChild(overlay);

  tab.term.selectAll();

  const textarea = document.createElement("textarea");
  textarea.className = "view-mode-textarea";
  textarea.readOnly = true;
  textarea.value = tab.term.getSelection();
  container.appendChild(textarea);
  textarea.scrollTop = textarea.scrollHeight;
}

function exitTerminalCopyMode(tabId) {
  const container = $(`frame-${tabId}`);
  if (!container) return;
  container.classList.remove("view-mode");
  const overlay = container.querySelector(".view-mode-overlay");
  if (overlay) overlay.remove();
  const textarea = container.querySelector(".view-mode-textarea");
  if (textarea) textarea.remove();
  const tab = tabs.find((t) => t.id === tabId);
  if (tab) tab.term.clearSelection();
}

document.addEventListener("paste", (e) => {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      e.stopPropagation();
      const file = item.getAsFile();
      if (file) uploadClipboardImage(file);
      return;
    }
  }
  const text = e.clipboardData.getData("text");
  if (text && activeTab.ws && activeTab.ws.readyState === WebSocket.OPEN) {
    e.preventDefault();
    activeTab.ws.send(new TextEncoder().encode(text));
  }
}, true);
