function saveTerminalTabs() {
  const data = tabs.filter((t) => t.type === "terminal").map((t) => ({ id: t.id, url: t.url, label: t.label }));
  localStorage.setItem(TERMINAL_TABS_KEY, JSON.stringify(data));
  if (activeTabId) {
    localStorage.setItem("pi_console_active_tab", activeTabId);
  } else {
    localStorage.removeItem("pi_console_active_tab");
  }
  updateOrphanSessions();
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
  const activeTab = tabs.find((t) => t.id === activeTabId);
  el.style.display = activeTab && activeTab.type === "terminal" ? "" : "none";
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
  const lastActive = localStorage.getItem("pi_console_active_tab");

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
    const restoreId = lastActive && tabs.some((t) => t.id === lastActive)
      ? lastActive
      : alive[alive.length - 1].id;
    switchTab(restoreId);
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

  const activeTab = tabs.find((t) => t.id === id);
  if (activeTab && activeTab.type === "terminal" && activeTab.label) {
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
  const bar = $("tab-bar");
  bar.style.display = "flex";

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
  html += '<button class="tab-add-btn" id="tab-add-btn" title="ターミナルを開く">+</button>';
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

function showTerminalWsPicker() {
  const list = $("terminal-ws-list");
  if (!list) return;

  list.innerHTML = "";
  for (const ws of visibleWorkspaces()) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ws-select-item";
    item.textContent = ws.name;
    item.addEventListener("click", () => {
      closeTerminalWsPicker();
      runJob("terminal", null, ws.name);
    });
    list.appendChild(item);
  }

  const picker = $("terminal-ws-picker");
  picker.style.display = "flex";
  $("terminal-ws-picker-close").onclick = closeTerminalWsPicker;
  picker.onclick = (e) => {
    if (e.target === picker) closeTerminalWsPicker();
  };
}

function closeTerminalWsPicker() {
  $("terminal-ws-picker").style.display = "none";
}
