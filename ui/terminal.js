let sessionKeepaliveTimer = null;
let lastVisibleTime = Date.now();

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
  const data = tabs.filter((t) => t.type === "terminal").map((t) => {
    const entry = { id: t.id, wsUrl: t.wsUrl, label: t.label };
    if (t.icon) entry.icon = t.icon;
    return entry;
  });
  localStorage.setItem(TERMINAL_TABS_KEY, JSON.stringify(data));
  if (activeTabId) {
    localStorage.setItem("pi_console_active_tab", activeTabId);
  } else {
    localStorage.removeItem("pi_console_active_tab");
  }
  updateOrphanSessions();
  if (data.length > 0) {
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
  orphanSessions = sessions
    .filter((s) => !localWsUrls.has(s.ws_url) && !closedSessionUrls.has(s.ws_url))
    .map((s) => ({ wsUrl: s.ws_url, workspace: s.workspace, expiresIn: s.expires_in }));
  for (const url of closedSessionUrls) {
    if (!sessions.some((s) => s.ws_url === url)) closedSessionUrls.delete(url);
  }
}

function joinOrphanSession(wsUrl, workspace) {
  const label = workspace || "terminal";
  addTerminalTab(wsUrl, label);
  orphanSessions = orphanSessions.filter((s) => s.wsUrl !== wsUrl);
  renderTabBar();
}

function updateQuickInputVisibility() {
  const el = $("quick-input");
  if (!el) return;
  el.style.display = panelBottom ? "" : "none";
}

function fitAndSync(tab, redraw) {
  try { tab.fitAddon.fit(); } catch {}
  const cols = tab.term.cols;
  const rows = tab.term.rows;
  if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
    const resizePayload = new Uint8Array([0, ...new TextEncoder().encode(JSON.stringify({ cols, rows }))]);
    tab.ws.send(resizePayload);
    if (redraw) tab.ws.send(new Uint8Array([0x0c]));
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
    const needRedraw = tab._reconnectAttempts > 0 || tab._restored;
    tab._reconnectAttempts = 0;
    tab._restored = false;
    const container = $(`frame-${tab.id}`);
    const isVisible = container && container.style.display !== "none";
    if (isVisible) {
      setTimeout(() => fitAndSync(tab, needRedraw), 150);
    } else {
      tab._needRedraw = needRedraw;
    }
    if (tab._initialCommand) {
      const cmd = tab._initialCommand;
      tab._initialCommand = null;
      setTimeout(() => {
        if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
          tab.ws.send(new TextEncoder().encode(cmd + "\n"));
        }
      }, 300);
    }
  };

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      if (e.data.byteLength === 0) return;
      tab.term.write(new Uint8Array(e.data));
    } else {
      if (e.data.length === 0) return;
      tab.term.write(e.data);
    }
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { tab.term.scrollToBottom(); scrollTimer = null; }, 200);
  };

  ws.onclose = (e) => {
    tab.ws = null;
    if (tab._wsDisposed) return;
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

async function restoreTerminalTabs() {
  const saved = JSON.parse(localStorage.getItem(TERMINAL_TABS_KEY) || "[]");
  if (saved.length === 0) return;

  if (saved.some((t) => t.url && !t.wsUrl)) {
    localStorage.removeItem(TERMINAL_TABS_KEY);
    return;
  }

  try {
    const res = await apiFetch("/terminal/sessions");
    if (!res || !res.ok) {
      localStorage.removeItem(TERMINAL_TABS_KEY);
      return;
    }
    const sessions = await res.json();
    const aliveWsUrls = new Set(sessions.map((s) => s.ws_url));

    const alive = saved.filter((t) => aliveWsUrls.has(t.wsUrl));
    if (alive.length === 0) {
      localStorage.removeItem(TERMINAL_TABS_KEY);
      return;
    }
    for (const t of alive) {
      addTerminalTab(t.wsUrl, t.label, t.id, true, true, null, t.icon || null);
    }
    startSessionKeepalive();
    const savedActive = localStorage.getItem("pi_console_active_tab");
    const restoreId = (savedActive && tabs.some((t) => t.id === savedActive))
      ? savedActive
      : tabs[tabs.length - 1]?.id ?? null;
    switchTab(restoreId);
  } catch {
    localStorage.removeItem(TERMINAL_TABS_KEY);
  }
}

function addTerminalTab(wsUrl, workspace, tabId, skipSwitch, restored, initialCommand, tabIcon) {
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
  term.open(container);

  const tab = { id, type: "terminal", wsUrl, label, term, fitAddon, ws: null, _restored: !!restored, _initialCommand: initialCommand || null, icon: tabIcon || null };
  tabs.push(tab);

  connectTerminalWs(tab);

  if (skipSwitch) return;
  saveTerminalTabs();
  switchTab(id);
}

function setOutputTab(id, label, htmlContent) {
  const existing = tabs.find((t) => t.id === id);
  if (existing) {
    existing.label = label;
    const el = $(`frame-${id}`);
    if (el) el.innerHTML = htmlContent;
    switchTab(id);
    return;
  }
  tabs.push({ id, type: "output", label });
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
  if (id) {
    localStorage.setItem("pi_console_active_tab", id);
  } else {
    localStorage.removeItem("pi_console_active_tab");
  }
  $("output").style.display = id === null ? "" : "none";
  for (const tab of tabs) {
    const el = $(`frame-${tab.id}`);
    if (el) {
      if (tab.id === id) {
        el.style.display = tab.type === "terminal" ? "block" : "";
        if (tab.type === "terminal") {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const wsReady = tab.ws && tab.ws.readyState === WebSocket.OPEN;
              const needRedraw = tab._needRedraw;
              if (wsReady) tab._needRedraw = false;
              fitAndSync(tab, needRedraw);
              tab.term.focus();
            });
          });
        }
      } else {
        el.style.display = "none";
      }
    }
  }
  updateQuickInputVisibility();
  renderTabBar();
  $("header-row2").style.display = "flex";

  if (id === null) {
    selectedWorkspace = null;
    localStorage.removeItem("pi_console_workspace");
    await updateHeaderInfo();
    await loadJobsForWorkspace();
    renderJobMenu();
    return;
  }

  const activeTab = tabs.find((t) => t.id === id);
  const isTerminalTab = activeTab && activeTab.type === "terminal";

  if (isTerminalTab && activeTab.label) {
    const ws = allWorkspaces.find((w) => w.name === activeTab.label);
    if (ws) {
      if (ws.name !== selectedWorkspace) {
        selectedWorkspace = ws.name;
        localStorage.setItem("pi_console_workspace", ws.name);
        await loadJobsForWorkspace();
      }
      await updateHeaderInfo();
      renderJobMenu();
    }
  }
}

function renderTabBar() {
  const barRow = $("tab-bar").parentNode;
  barRow.style.display = "flex";
  const bar = $("tab-bar");

  let html = "";
  for (const tab of tabs) {
    const iconHtml = tab.icon
      ? renderIcon(tab.icon.name, tab.icon.color, 14) + " "
      : "";
    html += `<button class="tab-btn${activeTabId === tab.id ? " active" : ""}" data-tab="${tab.id}">`
      + `${iconHtml}${escapeHtml(tab.label)}<span class="tab-close" data-close="${tab.id}">&times;</span></button>`;
  }
  for (const s of orphanSessions) {
    const label = s.workspace || "terminal";
    html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.wsUrl)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" title="他デバイスのセッション">`
      + `${escapeHtml(label)}</button>`;
  }
  html += '<button class="tab-add-btn" id="tab-add-btn" title="ターミナル・ジョブを開く">+</button>';
  bar.innerHTML = html;

  bar.querySelectorAll(".tab-btn:not(.orphan)").forEach((btn) => {
    let longPressTimer = null;
    let didLongPress = false;
    btn.addEventListener("touchstart", (e) => {
      didLongPress = false;
      longPressTimer = setTimeout(() => {
        didLongPress = true;
        if (confirm(`「${btn.textContent.replace("×", "").trim()}」を閉じますか？`)) {
          removeTab(btn.dataset.tab);
        }
      }, 500);
    }, { passive: true });
    btn.addEventListener("touchend", (e) => {
      clearTimeout(longPressTimer);
      if (didLongPress) e.preventDefault();
    });
    btn.addEventListener("touchmove", () => clearTimeout(longPressTimer));
    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close") || didLongPress) return;
      switchTab(btn.dataset.tab);
    });
  });
  bar.querySelectorAll(".tab-btn.orphan").forEach((btn) => {
    btn.addEventListener("click", () => {
      joinOrphanSession(btn.dataset.orphanUrl, btn.dataset.orphanWs);
    });
  });
  bar.querySelectorAll(".tab-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeTab(btn.dataset.close);
    });
  });
  $("tab-add-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    showTerminalWsPicker();
  });

  const activeBtn = bar.querySelector(".tab-btn.active");
  if (activeBtn) activeBtn.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function addLinkEditHandlers(btn, workspace, index, link) {
  addLongPressEditHandler(btn, () => {
    closeTerminalWsPicker();
    openItemEditModal("link", {
      workspace, index,
      label: link.label || link.url,
      url: link.url,
      icon: link.icon,
      iconColor: link.icon_color,
    });
  });
}

function addJobEditHandlers(btn, workspace, jobName, job) {
  addLongPressEditHandler(btn, () => {
    closeTerminalWsPicker();
    openItemEditModal("job", {
      workspace,
      name: jobName,
      label: job.label || jobName,
      icon: job.icon,
      iconColor: job.icon_color,
      scriptContent: job.script_content || "",
    });
  });
}

function showTerminalWsPicker() {
  const list = $("terminal-ws-list");
  if (!list) return;
  list.innerHTML = "";
  const workspaces = visibleWorkspaces();

  for (const ws of workspaces) {
    const group = document.createElement("div");
    group.className = "picker-ws-group";

    const header = document.createElement("div");
    header.className = "picker-ws-header";
    if (ws.icon) {
      const wsIconEl = document.createElement("span");
      wsIconEl.className = "picker-ws-favicon";
      wsIconEl.innerHTML = renderIcon(ws.icon, ws.icon_color, 16);
      header.appendChild(wsIconEl);
    }
    const headerLabel = document.createElement("button");
    headerLabel.type = "button";
    headerLabel.className = "picker-ws-header-label";
    headerLabel.textContent = ws.name;
    headerLabel.addEventListener("click", () => {
      closeTerminalWsPicker();
      runJob("terminal", null, ws.name);
    });
    header.appendChild(headerLabel);

    const icons = document.createElement("div");
    icons.className = "picker-ws-icons";
    header.appendChild(icons);

    group.appendChild(header);
    list.appendChild(group);

    loadPickerWsIcons(icons, ws);
  }

  const wsSettingsBtn = document.createElement("button");
  wsSettingsBtn.type = "button";
  wsSettingsBtn.className = "picker-ws-settings-btn";
  wsSettingsBtn.textContent = "ワークスペース設定";
  wsSettingsBtn.addEventListener("click", () => {
    closeTerminalWsPicker();
    openSettingsWsVisibility();
  });
  list.appendChild(wsSettingsBtn);

  const picker = $("terminal-ws-picker");
  picker.style.display = "flex";
  $("terminal-ws-picker-close").onclick = closeTerminalWsPicker;
  picker.onclick = (e) => {
    if (e.target === picker) closeTerminalWsPicker();
  };
}

async function loadPickerWsIcons(container, ws) {
  let jobs = {};
  let links = [];
  try {
    const [jobsRes, linksRes] = await Promise.all([
      apiFetch(workspaceApiPath(ws.name, "/jobs")),
      apiFetch(workspaceApiPath(ws.name, "/links")),
    ]);
    if (jobsRes && jobsRes.ok) jobs = await jobsRes.json();
    if (linksRes && linksRes.ok) links = await linksRes.json();
  } catch {}

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-ws-icon-btn";
    btn.title = link.label || link.url;
    btn.innerHTML = renderIcon(link.icon || "mdi-web", link.icon_color, 16);
    btn.addEventListener("click", () => {
      window.open(link.url, "_blank");
      closeTerminalWsPicker();
    });
    addLinkEditHandlers(btn, ws.name, i, link);
    container.appendChild(btn);
  }

  const entries = Object.entries(jobs).filter(([name]) => name !== "terminal");
  for (const [name, job] of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-ws-icon-btn";
    btn.title = job.label || name;
    btn.innerHTML = renderIcon(job.icon || "mdi-play", job.icon_color, 16);
    btn.addEventListener("click", () => {
      closeTerminalWsPicker();
      if (job.args && job.args.length > 0) {
        selectedWorkspace = ws.name;
        localStorage.setItem("pi_console_workspace", ws.name);
        openJobConfirmModal(name);
      } else {
        runJob(name, null, ws.name);
      }
    });
    addJobEditHandlers(btn, ws.name, name, job);
    container.appendChild(btn);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "picker-ws-icon-btn picker-ws-add-btn";
  addBtn.title = "追加";
  addBtn.innerHTML = "+";
  addBtn.addEventListener("click", () => {
    closeTerminalWsPicker();
    selectedWorkspace = ws.name;
    localStorage.setItem("pi_console_workspace", ws.name);
    openItemCreateModal(ws.name, "link");
  });
  container.appendChild(addBtn);
}

function closeTerminalWsPicker() {
  $("terminal-ws-picker").style.display = "none";
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
});
