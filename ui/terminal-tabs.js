function tabDisplayName(tab) {
  if (!tab) return "";
  const parts = [tab.workspace || tab.label];
  if (tab.jobName) parts.push(tab.jobName);
  return parts.join(" / ");
}

function renderTabIconHtml(tab, size = 14) {
  return (tab.wsIcon ? renderIcon(tab.wsIcon.name, tab.wsIcon.color, size) : "")
       + (tab.icon ? renderIcon(tab.icon.name, tab.icon.color, size) : "");
}

function addTerminalTab(wsUrl, workspace, tabId, skipSwitch, restored, initialCommand, tabIcon, wsIcon, jobName) {
  const id = tabId || `term-${++terminalIdCounter}`;
  if (tabId) {
    const m = tabId.match(/^term-(\d+)$/);
    if (m) terminalIdCounter = Math.max(terminalIdCounter, parseInt(m[1]));
  }
  const label = workspace || "terminal";
  if (openTabs.some((t) => t.id === id)) return;

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
    if (e.key === "Enter" && e.shiftKey) {
      if (e.type === "keydown") {
        term.paste("\x16\x0a");
      }
      return false;
    }
    return true;
  });

  if (isTouchDevice) {
    const patchTextarea = () => {
      const ta = container.querySelector("textarea");
      if (!ta || ta._focusPatched) return;
      ta._focusPatched = true;
      const origFocus = ta.focus.bind(ta);
      ta.focus = (opts) => { if (!splitMode) origFocus(opts); };
    };
    const obs = new MutationObserver(patchTextarea);
    obs.observe(container, { childList: true, subtree: true });
    patchTextarea();
  }

  let touchStartY = null;
  container.addEventListener("touchstart", (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  container.addEventListener("touchend", (e) => {
    if (container.classList.contains("view-mode")) return;
    if (splitMode) return;
    if (!isTouchDevice) return;
    if (e.target.closest(".tab-name-pill")) return;
    const endY = e.changedTouches[0].clientY;
    if (touchStartY !== null && Math.abs(endY - touchStartY) > 10) return;
    showKeyboardInput();
  });


  const tab = { id, type: "terminal", wsUrl, label, term, fitAddon, ws: null, _initialCommand: initialCommand || null, icon: tabIcon || null, wsIcon: wsIcon || null, jobName: jobName || null, _pendingOpen: !!restored, _pendingRedraw: !!restored };
  openTabs.push(tab);
  createTabNamePill(tab, container);

  if (!restored) {
    term.open(container);
    connectTerminalWs(tab);
  }

  if (skipSwitch) return;
  syncTerminalSessionState();
  switchTab(id);
}

function setOutputTab(id, label, htmlContent, icon, wsIcon, workspace) {
  const existing = openTabs.find((t) => t.id === id);
  if (existing) {
    existing.label = label;
    if (icon !== undefined) existing.icon = icon;
    if (wsIcon !== undefined) existing.wsIcon = wsIcon;
    if (workspace !== undefined) existing.workspace = workspace;
    const el = $(`frame-${id}`);
    if (el) {
      el.innerHTML = htmlContent;
      createTabNamePill(existing, el);
    }
    switchTab(id);
    return;
  }
  const tab = { id, type: "output", label, icon: icon || null, wsIcon: wsIcon || null, workspace: workspace || null };
  openTabs.push(tab);
  const div = document.createElement("div");
  div.className = "output-area";
  div.id = `frame-${id}`;
  div.innerHTML = htmlContent;
  div.style.display = "none";
  $("output-container").appendChild(div);
  createTabNamePill(tab, div);
  switchTab(id);
}

function removeTab(id) {
  const tab = openTabs.find((t) => t.id === id);
  if (!tab) return;

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
        deleteTerminalSession(match[1]);
      }
    }
    tab._wsDisposed = true;
    if (tab._reconnectTimer) clearTimeout(tab._reconnectTimer);
    if (tab._activityTimer) clearTimeout(tab._activityTimer);
    if (tab.ws) tab.ws.close();
    if (tab.fitAddon) try { tab.fitAddon.dispose(); } catch (e) { console.warn("fitAddon.dispose failed:", e); }
    if (tab.term) tab.term.dispose();
  }
  openTabs = openTabs.filter((t) => t.id !== id);
  const el = $(`frame-${id}`);
  if (el) el.remove();
  syncTerminalSessionState();

  if (splitMode) {
    if (openTabs.length === 0) {
      exitSplitModeWithTab(null);
      updateHeaderForTab(null);
      if (!document.getElementById("split-tab-modal-overlay")) openTabEditModal("open");
      return;
    }
    rebuildSplitLayout();
    return;
  }

  if (openTabs.length === 0) {
    activeTabId = null;
    renderTabBar();
    updateHeaderForTab(null);
    if (!document.getElementById("split-tab-modal-overlay")) openTabEditModal("open");
  } else if (activeTabId === id) {
    const next = openTabs[openTabs.length - 1].id;
    switchTab(next);
  } else {
    renderTabBar();
  }
}

async function switchTab(id) {
  if (splitMode) {
    const switchedTab = openTabs.find((t) => t.id === id);
    if (switchedTab) switchedTab._activity = false;

    const needsRebuild = openTabs.length !== splitPaneTabIds.length ||
      openTabs.some((t) => !splitPaneTabIds.includes(t.id));
    if (needsRebuild) {
      splitPaneTabIds = openTabs.map((t) => t.id);
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

  exitAllCopyModes();

  activeTabId = id;
  const switchedTab = openTabs.find((t) => t.id === id);
  if (switchedTab) switchedTab._activity = false;
  if (document.title.startsWith("* ")) {
    document.title = document.title.slice(2);
  }

  syncWorkspaceForTab(id);

  $("output").style.display = id === null ? "" : "none";
  for (const tab of openTabs) {
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

function syncWorkspaceForTab(id) {
  if (splitMode || id === null) {
    selectedWorkspace = null;
    return;
  }
  const tab = openTabs.find((t) => t.id === id);
  if (tab && tab.type === "terminal" && tab.label) {
    const ws = allWorkspaces.find((w) => w.name === tab.label);
    if (ws) selectedWorkspace = ws.name;
  }
}

async function updateHeaderForTab(id) {
  if (splitMode || id === null) {
    selectedWorkspace = null;
    await refreshWorkspaceHeader();
    await loadJobsForWorkspace();
    updateGitBarVisibility();
    return;
  }

  const activeTab = openTabs.find((t) => t.id === id);
  const isTerminalTab = activeTab && activeTab.type === "terminal";

  if (isTerminalTab && activeTab.label) {
    const ws = allWorkspaces.find((w) => w.name === activeTab.label);
    if (ws) {
      await loadJobsForWorkspace();
      await refreshWorkspaceHeader();
    }
  }
  updateGitBarVisibility();
}

function updateGitBarVisibility() {
  const show = selectedWorkspace && !splitMode;
  $("header-row2").style.display = show ? "flex" : "none";
  if (!show) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  const isGitRepo = ws && ws.branch !== null;
  const hasUpstream = ws ? ws.has_upstream !== false : true;
  $("header-commit-msg").style.display = isGitRepo ? "" : "none";
  $("clean-dirty-status").style.display = isGitRepo ? "" : "none";
  $("main-git-status").style.display = isGitRepo ? "" : "none";
  $("git-actions").style.display = isGitRepo && (ws.behind > 0 || ws.ahead > 0 || !hasUpstream) ? "flex" : "none";
  let hint = $("non-git-hint");
  if (!isGitRepo) {
    if (!hint) {
      hint = document.createElement("span");
      hint.id = "non-git-hint";
      hint.className = "non-git-hint";
      hint.textContent = "Gitリポジトリではありません";
      $("header-row2").appendChild(hint);
    }
    hint.style.display = "";
  } else if (hint) {
    hint.style.display = "none";
  }
}

function renderTabBar() {
  if (tabDragState) return;
  const barRow = $("tab-bar").parentNode;
  if (splitMode) {
    barRow.style.display = "none";
    updateEmptyPlaceholder(openTabs.length === 0);
    return;
  }
  const bar = $("tab-bar");
  const items = openTabs.map((tab, i) => ({ type: "tab", tab, index: i }));
  for (const s of disconnectedSessions) {
    items.push({ type: "orphan", orphan: s, index: s.tabIndex != null ? s.tabIndex : items.length });
  }
  items.sort((a, b) => a.index - b.index);

  const hasAnyTabs = openTabs.length > 0 || disconnectedSessions.length > 0;
  barRow.style.display = hasAnyTabs ? "flex" : "none";
  const hasActiveContent = openTabs.some((t) => t.id === activeTabId);
  updateEmptyPlaceholder(!hasActiveContent);
  if (!hasAnyTabs) return;

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
      const expiredCls = s.expired ? " expired" : "";
      const suffix = panelBottom ? "" : `${escapeHtml(label)}<span class="tab-close" data-close-orphan="${escapeHtml(s.wsUrl)}">&times;</span>`;
      html += `<button class="tab-btn orphan${expiredCls}" data-orphan-url="${escapeHtml(s.wsUrl)}" data-orphan-ws="${escapeHtml(s.workspace || "")}" data-orphan-expired="${s.expired ? "true" : ""}">${owsIconHtml}${orphanIcon}${suffix}</button>`;
    }
  }
  bar.innerHTML = html;

  bar.addEventListener("dblclick", (e) => {
    if (!e.target.closest(".tab-btn")) openTabEditModal("open");
  });

  bar.querySelectorAll(".tab-btn:not(.orphan)").forEach((btn) => {
    const tab = openTabs.find((t) => t.id === btn.dataset.tab);
    if (panelBottom) {
      bindLongPress(btn, {
        onLongPress: () => {
          openTabEditModal();
        },
        onClick: (e) => {
          if (e.target.classList.contains("tab-close")) return;
          const tabId = btn.dataset.tab;
          if (tabId === activeTabId) {
            openTabEditModal("open");
            return;
          }
          switchTab(tabId);
        },
      });
    } else {
      btn.addEventListener("click", (e) => {
        if (e.target.classList.contains("tab-close")) return;
        const tabId = btn.dataset.tab;
        if (tabId === activeTabId) {
          openTabEditModal("open");
          return;
        }
        switchTab(tabId);
      });
      if (tab) bindMouseDrag(btn, tab);
    }
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openTabEditModal();
    });
  });
  bar.querySelectorAll(".tab-btn.orphan").forEach((btn) => {
    const isExpired = btn.dataset.orphanExpired === "true";
    bindLongPress(btn, {
      onLongPress: () => {
        const label = btn.dataset.orphanWs || "terminal";
        if (confirm(`「${label}」を閉じますか？`)) {
          const wsUrl = btn.dataset.orphanUrl;
          if (!isExpired) {
            const match = wsUrl.match(/\/terminal\/ws\/([^/]+)/);
            if (match) {
              deleteTerminalSession(match[1]);
            }
          }
          disconnectedSessions = disconnectedSessions.filter((s) => s.wsUrl !== wsUrl);
          closedSessionUrls.add(wsUrl);
          renderTabBar();
        }
      },
      onClick: (e) => {
        if (e.target.classList.contains("tab-close")) return;
        if (isExpired) {
          const wsUrl = btn.dataset.orphanUrl;
          const orphan = disconnectedSessions.find((s) => s.wsUrl === wsUrl);
          const workspace = btn.dataset.orphanWs;
          disconnectedSessions = disconnectedSessions.filter((s) => s.wsUrl !== wsUrl);
          closedSessionUrls.add(wsUrl);
          runJob(orphan?.jobName || "terminal", null, workspace);
          return;
        }
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
        const orphan = disconnectedSessions.find((s) => s.wsUrl === wsUrl);
        const label = orphan?.workspace || "terminal";
        if (!confirm(`「${label}」を閉じますか？`)) return;
        if (!orphan?.expired) {
          const match = wsUrl.match(/\/terminal\/ws\/([^/]+)/);
          if (match) {
            deleteTerminalSession(match[1]);
          }
        }
        disconnectedSessions = disconnectedSessions.filter((s) => s.wsUrl !== wsUrl);
        closedSessionUrls.add(wsUrl);
        renderTabBar();
      }
    });
  });
  const activeBtn = bar.querySelector(".tab-btn.active");
  if (activeBtn) activeBtn.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function updateEmptyPlaceholder(show) {
  const container = $("output-container");
  const outputArea = $("output");
  const existing = container.querySelector(".empty-tab-placeholder");
  if (show) {
    if (!existing) {
      const ph = document.createElement("div");
      ph.className = "empty-tab-placeholder";
      ph.innerHTML = `<button type="button" class="empty-tab-open-btn"><span class="mdi mdi-plus"></span> ワークスペースを開く</button>`;
      ph.querySelector("button").addEventListener("click", () => openTabEditModal("open"));
      container.appendChild(ph);
    }
    if (outputArea) outputArea.style.display = "none";
  } else {
    if (existing) existing.remove();
    if (outputArea) outputArea.style.display = "";
  }
}

function createTabNamePill(tab, frame) {
  const pill = document.createElement("div");
  pill.className = "tab-name-pill";
  const info = document.createElement("span");
  info.className = "tab-name-pill-info";
  info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tab.label || "");
  pill.appendChild(info);
  bindLongPress(pill, {
    onLongPress: () => {
      if (tab.type === "terminal") {
        const f = $(`frame-${tab.id}`);
        if (f && f.classList.contains("view-mode")) {
          exitTerminalCopyMode(tab.id);
        } else {
          tab.term && tab.term.scrollToBottom();
          enterTerminalCopyMode(tab.id);
        }
      }
    },
    onClick: () => {
      if (tab.type === "terminal") {
        const f = $(`frame-${tab.id}`);
        if (f && f.classList.contains("view-mode")) {
          exitTerminalCopyMode(tab.id);
          return;
        }
      }
      openTabEditModal("open");
    },
  });
  pill.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openTabEditModal("layout");
  });
  pill.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (splitMode) {
      exitSplitModeWithTab(tab.id);
    } else {
      switchTab(tab.id);
    }
  });
  frame.appendChild(pill);
}

function refreshTabNamePill(tab) {
  const frame = $(`frame-${tab.id}`);
  if (!frame) return;
  const info = frame.querySelector(".tab-name-pill-info");
  if (info) {
    info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tab.label || "");
  }
}
