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
  orphanSessions = sessions
    .filter((s) => !localWsUrls.has(s.ws_url) && !closedSessionUrls.has(s.ws_url))
    .map((s) => ({ wsUrl: s.ws_url, workspace: s.workspace, expiresIn: s.expires_in, icon: s.icon, iconColor: s.icon_color }));
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
  addTerminalTab(wsUrl, label, null, false, false, null, tabIcon, wsIcon);
  const tab = tabs.find((t) => t.wsUrl === wsUrl);
  if (tab) tab._pendingRedraw = true;
  orphanSessions = orphanSessions.filter((s) => s.wsUrl !== wsUrl);
  renderTabBar();
}

function updateQuickInputVisibility() {
  const el = $("quick-input");
  if (!el) return;
  el.style.display = isTouchDevice ? "" : "none";
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
    if (e.data instanceof ArrayBuffer) {
      if (e.data.byteLength === 0) return;
      tab.term.write(new Uint8Array(e.data));
    } else {
      if (e.data.length === 0) return;
      tab.term.write(e.data);
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


function addTerminalTab(wsUrl, workspace, tabId, skipSwitch, restored, initialCommand, tabIcon, wsIcon) {
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

  {
    let longPressTimer = null;
    let didLongPress = false;
    container.addEventListener("touchstart", () => {
      didLongPress = false;
      longPressTimer = setTimeout(() => {
        didLongPress = true;
        enterTerminalCopyMode(id);
      }, 500);
    }, { passive: true });
    container.addEventListener("touchend", (e) => {
      clearTimeout(longPressTimer);
      if (didLongPress) { e.preventDefault(); return; }
      if (container.classList.contains("copy-mode")) return;
      if (isTouchDevice) showKeyboardInput();
    });
    container.addEventListener("touchmove", () => clearTimeout(longPressTimer), { passive: true });
  }

  const tab = { id, type: "terminal", wsUrl, label, term, fitAddon, ws: null, _initialCommand: initialCommand || null, icon: tabIcon || null, wsIcon: wsIcon || null, _pendingOpen: !!restored, _pendingRedraw: !!restored };
  tabs.push(tab);

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
  $("header-row2").style.display = "flex";

  if (id === null) {
    selectedWorkspace = null;
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
    if (panelBottom) {
      const wsIconHtml = tab.wsIcon ? renderIcon(tab.wsIcon.name, tab.wsIcon.color, 14) + " " : "";
      html += `<button class="tab-btn${activeTabId === tab.id ? " active" : ""}" data-tab="${tab.id}">`
        + `${wsIconHtml}${iconHtml}</button>`;
    } else {
      html += `<button class="tab-btn${activeTabId === tab.id ? " active" : ""}" data-tab="${tab.id}">`
        + `${iconHtml}${escapeHtml(tab.label)}<span class="tab-close" data-close="${tab.id}">&times;</span></button>`;
    }
  }
  for (const s of orphanSessions) {
    const label = s.workspace || "terminal";
    const orphanIcon = renderIcon(s.icon || "mdi-console", s.iconColor || "", 14) + " ";
    if (panelBottom) {
      const ows = s.workspace ? allWorkspaces.find((w) => w.name === s.workspace) : null;
      const owsIconHtml = ows && ows.icon ? renderIcon(ows.icon, ows.icon_color, 14) + " " : "";
      html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.wsUrl)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" title="他デバイスのセッション">`
        + `${owsIconHtml}${orphanIcon}</button>`;
    } else {
      html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.wsUrl)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" title="他デバイスのセッション">`
        + `${orphanIcon}${escapeHtml(label)}</button>`;
    }
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
        const tab = tabs.find((t) => t.id === btn.dataset.tab);
        const tabName = tab && tab.workspace ? `${tab.workspace} / ${tab.label}` : tab ? tab.label : btn.textContent.replace("×", "").trim();
        if (confirm(`「${tabName}」を閉じますか？`)) {
          removeTab(btn.dataset.tab);
        }
      }, 500);
    }, { passive: true });
    btn.addEventListener("touchend", (e) => {
      clearTimeout(longPressTimer);
      if (didLongPress) e.preventDefault();
    });
    btn.addEventListener("touchmove", () => clearTimeout(longPressTimer), { passive: true });
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
      const tabId = btn.dataset.close;
      const tab = tabs.find((t) => t.id === tabId);
      const tabName = tab && tab.workspace ? `${tab.workspace} / ${tab.label}` : tab ? tab.label : "";
      if (tabName && !confirm(`「${tabName}」を閉じますか？`)) return;
      removeTab(tabId);
    });
  });
  $("tab-add-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    showTerminalWsPicker();
  });

  const activeBtn = bar.querySelector(".tab-btn.active");
  if (activeBtn) activeBtn.scrollIntoView({ inline: "nearest", block: "nearest" });
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
    const headerLabel = document.createElement("button");
    headerLabel.type = "button";
    headerLabel.className = "picker-ws-header-label";
    headerLabel.innerHTML = renderIcon(ws.icon || "mdi-console", ws.icon_color, 16) + " " + escapeHtml(ws.name);
    headerLabel.addEventListener("click", () => {
      closeTerminalWsPicker();
      runJob("terminal", null, ws.name);
    });
    header.appendChild(headerLabel);

    const fileBtn = document.createElement("button");
    fileBtn.type = "button";
    fileBtn.className = "picker-ws-icon-btn picker-ws-file-btn";
    fileBtn.title = "ファイル一覧";
    fileBtn.innerHTML = renderIcon("mdi-folder", "", 18);
    fileBtn.addEventListener("click", () => {
      closeTerminalWsPicker();
      selectedWorkspace = ws.name;
      renderWorkspaceSelects();
      openFileBrowser();
    });
    header.insertBefore(fileBtn, headerLabel);

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
    btn.className = "picker-ws-icon-btn picker-ws-link-btn";
    btn.title = link.label || link.url;
    btn.innerHTML = renderIcon(link.icon || "mdi-web", link.icon_color, 18);
    btn.addEventListener("click", () => {
      window.open(link.url, "_blank");
      closeTerminalWsPicker();
    });
    container.appendChild(btn);
  }

  const entries = Object.entries(jobs).filter(([name]) => name !== "terminal");
  for (const [name, job] of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-ws-icon-btn";
    btn.title = job.label || name;
    btn.innerHTML = renderIcon(job.icon || "mdi-play", job.icon_color, 18);
    btn.addEventListener("click", () => {
      if (job.confirm !== false) {
        if (!confirm(`${job.label || name} を実行しますか？`)) return;
      }
      closeTerminalWsPicker();
      runJob(name, null, ws.name);
    });
    container.appendChild(btn);
  }
}


function closeTerminalWsPicker() {
  $("terminal-ws-picker").style.display = "none";
}

function enterTerminalCopyMode(tabId) {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || tab.type !== "terminal") return;
  const container = $(`frame-${tabId}`);
  if (!container || container.classList.contains("copy-mode")) return;

  container.classList.add("copy-mode");

  const wrapper = $("keyboard-input");
  if (wrapper) {
    const kbWrapper = wrapper.closest(".keyboard-input-wrapper");
    if (kbWrapper) kbWrapper.style.display = "none";
  }

  const bar = document.createElement("div");
  bar.className = "copy-mode-bar";
  bar.innerHTML = '<button class="copy-mode-btn copy-mode-copy-btn">全コピー</button>'
    + '<button class="copy-mode-btn copy-mode-close-btn">閉じる</button>';
  container.appendChild(bar);

  tab.term.selectAll();

  const textarea = document.createElement("textarea");
  textarea.className = "copy-mode-textarea";
  textarea.readOnly = true;
  textarea.value = tab.term.getSelection();
  container.appendChild(textarea);
  textarea.scrollTop = textarea.scrollHeight;

  bar.querySelector(".copy-mode-copy-btn").addEventListener("click", () => {
    const text = textarea.selectionStart !== textarea.selectionEnd
      ? textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
      : textarea.value;
    copyToClipboard(text);
    showToast("コピーしました", "success");
  });

  bar.querySelector(".copy-mode-close-btn").addEventListener("click", () => {
    exitTerminalCopyMode(tabId);
  });
}

function exitTerminalCopyMode(tabId) {
  const container = $(`frame-${tabId}`);
  if (!container) return;
  container.classList.remove("copy-mode");
  const bar = container.querySelector(".copy-mode-bar");
  if (bar) bar.remove();
  const textarea = container.querySelector(".copy-mode-textarea");
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
