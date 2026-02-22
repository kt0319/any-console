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
    await fetch("/terminal/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
}

async function onVisibilityRestore() {
  const elapsed = Date.now() - lastVisibleTime;
  lastVisibleTime = Date.now();
  if (elapsed < 30_000) return;

  const termTabs = tabs.filter((t) => t.type === "terminal");
  if (termTabs.length === 0) return;

  try {
    const res = await fetch("/terminal/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const sessions = await res.json();
    const aliveUrls = new Set(sessions.map((s) => s.url));

    for (const tab of termTabs) {
      const frame = $(`frame-${tab.id}`);
      if (!frame) continue;
      if (aliveUrls.has(tab.url)) {
        frame.src = tab.url;
      } else {
        removeTab(tab.id);
        showToast("ターミナルセッションが期限切れになりました");
      }
    }
  } catch {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    onVisibilityRestore();
  } else {
    lastVisibleTime = Date.now();
  }
});

function saveTerminalTabs() {
  const data = tabs.filter((t) => t.type === "terminal").map((t) => ({ id: t.id, url: t.url, label: t.label }));
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
    const res = await fetch("/terminal/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
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
  const localUrls = new Set(tabs.filter((t) => t.type === "terminal").map((t) => t.url));
  orphanSessions = orphanSessions.filter((s) => !localUrls.has(s.url));
}

function updateOrphanFromSessions(sessions) {
  const localUrls = new Set(tabs.filter((t) => t.type === "terminal").map((t) => t.url));
  orphanSessions = sessions
    .filter((s) => !localUrls.has(s.url) && !closedSessionUrls.has(s.url))
    .map((s) => ({ url: s.url, workspace: s.workspace, expiresIn: s.expires_in }));
  for (const url of closedSessionUrls) {
    if (!sessions.some((s) => s.url === url)) closedSessionUrls.delete(url);
  }
}

function joinOrphanSession(url, workspace) {
  const label = workspace || "terminal";
  addTerminalTab(url, label);
  orphanSessions = orphanSessions.filter((s) => s.url !== url);
  renderTabBar();
}

function updateQuickInputVisibility() {
  const el = $("quick-input");
  if (!el) return;
  el.style.display = "";
}

function attachPasteListener(iframe) {
  try {
    const doc = iframe.contentDocument;
    if (!doc) {
      console.warn("[paste] contentDocument is null (cross-origin?)");
      return;
    }
    console.warn("[paste] listener attached to iframe");
    doc.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      console.warn("[paste] paste event fired, items:", items?.length);
      if (!items) return;
      for (const item of items) {
        console.warn("[paste] item:", item.kind, item.type);
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (file) uploadClipboardImage(file);
          return;
        }
      }
    }, { capture: true });
  } catch (err) {
    console.error("[paste] attachPasteListener failed:", err);
  }
}

async function restoreTerminalTabs() {
  const saved = JSON.parse(localStorage.getItem(TERMINAL_TABS_KEY) || "[]");
  if (saved.length === 0) return;

  try {
    const res = await fetch("/terminal/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      localStorage.removeItem(TERMINAL_TABS_KEY);
      return;
    }
    const sessions = await res.json();
    const aliveUrls = new Set(sessions.map((s) => s.url));

    const alive = saved.filter((t) => aliveUrls.has(t.url));
    if (alive.length === 0) {
      localStorage.removeItem(TERMINAL_TABS_KEY);
      return;
    }
    for (const t of alive) {
      addTerminalTab(t.url, t.label, t.id, true);
    }
    startSessionKeepalive();
    switchTab(null);
  } catch {
    localStorage.removeItem(TERMINAL_TABS_KEY);
  }
}

function addTerminalTab(url, workspace, tabId, skipSwitch) {
  const id = tabId || `term-${++terminalIdCounter}`;
  if (tabId) {
    const m = tabId.match(/^term-(\d+)$/);
    if (m) terminalIdCounter = Math.max(terminalIdCounter, parseInt(m[1]));
  }
  const label = workspace || "terminal";
  if (tabs.some((t) => t.id === id)) return;
  tabs.push({ id, type: "terminal", url, label });

  const iframe = document.createElement("iframe");
  iframe.className = "terminal-frame";
  iframe.id = `frame-${id}`;
  iframe.src = url;
  iframe.style.display = "none";
  iframe.addEventListener("load", () => {
    attachPasteListener(iframe);
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        doc.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
        doc.addEventListener("touchmove", (e) => {
          if (e.touches.length > 1) e.preventDefault();
        }, { passive: false });
      }
    } catch (err) {}
  });
  $("output-container").appendChild(iframe);

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
  if (tab && tab.type === "terminal" && tab.url) {
    closedSessionUrls.add(tab.url);
    const match = tab.url.match(/\/terminal\/s\/([^/]+)\//);
    if (match) {
      fetch(`/terminal/sessions/${match[1]}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
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

function switchTab(id) {
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
          try { el.contentWindow.focus(); } catch {}
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
    updateHeaderInfo();
    loadJobsForWorkspace();
    renderJobMenu();
    return;
  }

  const activeTab = tabs.find((t) => t.id === id);
  const isTerminalTab = activeTab && activeTab.type === "terminal";

  if (isTerminalTab && activeTab.label) {
    const ws = allWorkspaces.find((w) => w.name === activeTab.label);
    if (ws && ws.name !== selectedWorkspace) {
      selectedWorkspace = ws.name;
      localStorage.setItem("pi_console_workspace", ws.name);
      updateHeaderInfo();
      loadJobsForWorkspace();
    }
  }
}

function renderTabBar() {
  const barRow = $("tab-bar").parentNode;
  barRow.style.display = "flex";
  const bar = $("tab-bar");

  let html = "";
  for (const tab of tabs) {
    html += `<button class="tab-btn${activeTabId === tab.id ? " active" : ""}" data-tab="${tab.id}">`
      + `${escapeHtml(tab.label)}<span class="tab-close" data-close="${tab.id}">&times;</span></button>`;
  }
  for (const s of orphanSessions) {
    const label = s.workspace || "terminal";
    html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.url)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" title="他デバイスのセッション">`
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

function buildGithubLinks(ws) {
  if (!ws || !ws.github_url) return null;
  const baseUrl = ws.github_url;
  const path = baseUrl.replace(/^https?:\/\/github\.com/, "");
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  const scheme = isMobile ? "github://github.com" : baseUrl;
  const branch = ws.branch || "main";
  return [
    { label: "GitHub", href: isMobile ? `${scheme}${path}/tree/${encodeURIComponent(branch)}` : `${baseUrl}/tree/${encodeURIComponent(branch)}` },
    { label: "Issues", href: `${scheme}${isMobile ? path : ""}/issues` },
    { label: "PRs", href: `${scheme}${isMobile ? path : ""}/pulls` },
    { label: "Actions", href: `${scheme}${isMobile ? path : ""}/actions` },
  ];
}

function addLinkDeleteHandlers(btn, workspace, index, label) {
  let holdTimer = null;
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    closeTerminalWsPicker();
    deleteLink(workspace, index, label);
  });
  btn.addEventListener("touchstart", () => {
    holdTimer = setTimeout(() => { closeTerminalWsPicker(); deleteLink(workspace, index, label); }, 600);
  }, { passive: true });
  btn.addEventListener("touchend", () => clearTimeout(holdTimer));
  btn.addEventListener("touchmove", () => clearTimeout(holdTimer));
}

function addJobDeleteHandlers(btn, jobName) {
  let holdTimer = null;
  btn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    closeTerminalWsPicker();
    deleteJob(jobName);
  });
  btn.addEventListener("touchstart", () => {
    holdTimer = setTimeout(() => { closeTerminalWsPicker(); deleteJob(jobName); }, 600);
  }, { passive: true });
  btn.addEventListener("touchend", () => clearTimeout(holdTimer));
  btn.addEventListener("touchmove", () => clearTimeout(holdTimer));
}

function showTerminalWsPicker() {
  const list = $("terminal-ws-list");
  if (!list) return;
  list.innerHTML = "";
  const workspaces = visibleWorkspaces();
  const currentWs = selectedWorkspace || (workspaces.length === 1 ? workspaces[0].name : null);

  for (const ws of workspaces) {
    const group = document.createElement("div");
    group.className = "picker-ws-group";

    const header = document.createElement("div");
    header.className = "picker-ws-header";
    const headerLabel = document.createElement("button");
    headerLabel.type = "button";
    headerLabel.className = "picker-ws-header-label";
    headerLabel.textContent = ws.name;
    headerLabel.addEventListener("click", () => {
      closeTerminalWsPicker();
      runJob("terminal", null, ws.name);
    });
    header.appendChild(headerLabel);
    const headerToggle = document.createElement("button");
    headerToggle.type = "button";
    headerToggle.className = "picker-ws-header-toggle";
    headerToggle.textContent = "▼";
    header.appendChild(headerToggle);
    group.appendChild(header);

    const body = document.createElement("div");
    body.className = "picker-ws-body";
    body.style.display = "none";
    let loaded = false;

    headerToggle.addEventListener("click", async () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "";
      headerToggle.textContent = open ? "▼" : "▲";
      if (!open && !loaded) {
        loaded = true;
        await renderPickerWsBody(body, ws);
      }
    });

    group.appendChild(body);
    list.appendChild(group);
  }

  const picker = $("terminal-ws-picker");
  picker.style.display = "flex";
  $("terminal-ws-picker-close").onclick = closeTerminalWsPicker;
  picker.onclick = (e) => {
    if (e.target === picker) closeTerminalWsPicker();
  };
}

async function renderPickerWsBody(body, ws) {
  body.innerHTML = "";

  const ghLinks = buildGithubLinks(ws);
  if (ghLinks) {
    const ghRow = document.createElement("div");
    ghRow.className = "picker-github-row";
    for (const link of ghLinks) {
      const a = document.createElement("a");
      a.className = "picker-github-link";
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener";
      if (link.label === "GitHub") {
        a.innerHTML = '<span class="mdi mdi-github"></span>';
        a.title = "GitHub";
      } else {
        a.textContent = link.label;
      }
      a.addEventListener("click", () => closeTerminalWsPicker());
      ghRow.appendChild(a);
    }
    body.appendChild(ghRow);
  }

  let jobs = {};
  let links = [];
  try {
    const [jobsRes, linksRes] = await Promise.all([
      fetch(`/workspaces/${encodeURIComponent(ws.name)}/jobs`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`/workspaces/${encodeURIComponent(ws.name)}/links`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    if (jobsRes.ok) jobs = await jobsRes.json();
    if (linksRes.ok) links = await linksRes.json();
  } catch {}

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ws-select-item ws-picker-url";
    btn.innerHTML = `<span class="picker-type-icon picker-icon-url">&#10697;</span>${escapeHtml(link.label)}`;
    btn.addEventListener("click", () => {
      window.open(link.url, "_blank");
      closeTerminalWsPicker();
    });
    addLinkDeleteHandlers(btn, ws.name, i, link.label);
    body.appendChild(btn);
  }

  const entries = Object.entries(jobs).filter(([name]) => name !== "terminal");
  for (const [name, job] of entries) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ws-select-item ws-picker-job";
    const label = job.label || name;
    btn.innerHTML = `<span class="picker-type-icon picker-icon-job">&#9654;</span>${escapeHtml(label)}`;
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
    addJobDeleteHandlers(btn, name);
    body.appendChild(btn);
  }

  const addLinkBtn = document.createElement("button");
  addLinkBtn.type = "button";
  addLinkBtn.className = "ws-select-item picker-job-add";
  addLinkBtn.textContent = "+ リンク追加";
  addLinkBtn.addEventListener("click", () => {
    closeTerminalWsPicker();
    openLinkCreateModal(ws.name);
  });
  body.appendChild(addLinkBtn);

  const addJobBtn = document.createElement("button");
  addJobBtn.type = "button";
  addJobBtn.className = "ws-select-item picker-job-add";
  addJobBtn.textContent = "+ ジョブ追加";
  addJobBtn.addEventListener("click", () => {
    closeTerminalWsPicker();
    selectedWorkspace = ws.name;
    localStorage.setItem("pi_console_workspace", ws.name);
    openJobCreateModal();
  });
  body.appendChild(addJobBtn);
}

function closeTerminalWsPicker() {
  $("terminal-ws-picker").style.display = "none";
}
