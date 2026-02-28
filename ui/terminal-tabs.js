function persistOpenTabs() {
  const openTerminalTabs = openTabs
    .filter(t => t.type === "terminal")
    .map(t => ({
      wsUrl: t.wsUrl,
      workspace: t.workspace || t.label,
      icon: t.icon?.name || null,
      iconColor: t.icon?.color || null,
      jobName: t.jobName || null,
      jobLabel: t.jobLabel || null,
      tabIndex: openTabs.indexOf(t),
    }));
  const liveUrls = new Set(openTerminalTabs.map((t) => t.wsUrl));
  const orphanTabs = disconnectedSessions
    .filter((s) => s && s.wsUrl && !closedSessionUrls.has(s.wsUrl) && !liveUrls.has(s.wsUrl))
    .map((s, i) => ({
      wsUrl: s.wsUrl,
      workspace: s.workspace || null,
      icon: s.icon || null,
      iconColor: s.iconColor || null,
      jobName: s.jobName || null,
      jobLabel: s.jobLabel || null,
      tabIndex: s.tabIndex != null ? s.tabIndex : (openTabs.length + i),
    }));
  const data = [...openTerminalTabs, ...orphanTabs];
  if (data.length === 0 && !hasRestoredTabsFromStorage) return;
  localStorage.setItem("pi_console_terminal_openTabs", JSON.stringify(data));
}

function tabDisplayName(tab) {
  if (!tab) return "";
  return tab.workspace || tab.label || "";
}

function renderTabIconHtml(tab, size = 14) {
  return (tab.wsIcon ? renderIcon(tab.wsIcon.name, tab.wsIcon.color, size) : "")
       + (tab.icon ? renderIcon(tab.icon.name, tab.icon.color, size) : "");
}

function relaunchExpiredOrphan(orphan, workspaceOverride = null) {
  if (!orphan) return Promise.resolve();
  const workspace = workspaceOverride || orphan.workspace || null;
  const targetJob = orphan.jobName || orphan.jobLabel || "terminal";
  disconnectedSessions = disconnectedSessions.filter((s) => s.wsUrl !== orphan.wsUrl);
  if (orphan.wsUrl) closedSessionUrls.add(orphan.wsUrl);
  return runJob(targetJob, null, workspace);
}

function addTerminalTab(wsUrl, workspace, tabId, skipSwitch, restored, initialCommand, tabIcon, wsIcon, jobName, jobLabel) {
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
    fontFamily: '"SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
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


  const tab = { id, type: "terminal", wsUrl, workspace: workspace || null, label, term, fitAddon, ws: null, _initialCommand: initialCommand || null, icon: tabIcon || null, wsIcon: wsIcon || null, jobName: jobName || null, jobLabel: jobLabel || null, _pendingOpen: true, _pendingRedraw: !!restored };
  openTabs.push(tab);
  createTabNamePill(tab, container);

  persistOpenTabs();
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

function removeTab(id, options = {}) {
  const preserveSessionForRestore = !!options.preserveSessionForRestore;
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
    if (tab.wsUrl && !preserveSessionForRestore) {
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
  persistOpenTabs();
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
    if (switchedTab) {
      switchedTab._activity = false;
      refreshTabNamePill(switchedTab);
    }

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
    updateHeaderForTab(activeTabId);
    return;
  }

  exitAllViewModes();

  activeTabId = id;
  const switchedTab = openTabs.find((t) => t.id === id);
  if (switchedTab) {
    switchedTab._activity = false;
    refreshTabNamePill(switchedTab);
  }
  if (document.title.startsWith("* ")) {
    document.title = document.title.slice(2);
  }

  syncWorkspaceForTab(id);

  $("output").style.display = id === null ? "" : "none";
  for (const tab of openTabs) {
    const el = $(`frame-${tab.id}`);
    if (el) {
      const isActive = tab.id === id;
      setFrameVisible(tab, el, isActive);
      if (isActive && tab.type === "terminal" && !ensureTerminalOpened(tab, el)) {
        refitTerminalWithFocus(tab);
      }
    }
  }
  updateQuickInputVisibility();
  renderTabBar();

  updateHeaderForTab(id);
}

function syncWorkspaceForTab(id) {
  if (splitMode || id === null) {
    selectedWorkspace = null;
    return;
  }
  const tab = openTabs.find((t) => t.id === id);
  if (!tab) return;
  const workspaceName = resolveWorkspaceNameForTab(tab);
  if (!workspaceName) return;
  const ws = allWorkspaces.find((w) => w.name === workspaceName);
  if (ws) {
    selectedWorkspace = ws.name;
    return;
  }
  selectedWorkspace = workspaceName;
}

function resolveWorkspaceNameForTab(tab) {
  if (!tab) return null;
  if (tab.workspace) return tab.workspace;
  if (tab.type === "terminal" && tab.label && tab.label !== "terminal") return tab.label;
  return null;
}

async function updateHeaderForTab(id) {
  if (splitMode || id === null) {
    selectedWorkspace = null;
    updateGitBarVisibility();
    await refreshWorkspaceHeader({ reloadBranches: false });
    await loadJobsForWorkspace();
    return;
  }

  const activeTab = openTabs.find((t) => t.id === id);
  const workspaceName = resolveWorkspaceNameForTab(activeTab);
  if (workspaceName) {
    const ws = allWorkspaces.find((w) => w.name === workspaceName);
    const nextWorkspace = ws ? ws.name : workspaceName;
    const workspaceChanged = selectedWorkspace !== nextWorkspace;
    selectedWorkspace = nextWorkspace;
    updateGitBarVisibility();
    const shouldReloadJobs = workspaceChanged || workspaceJobsLoadedFor !== nextWorkspace;
    if (shouldReloadJobs) {
      await loadJobsForWorkspace(workspaceChanged);
    }
    await refreshWorkspaceHeader({ reloadBranches: workspaceChanged });
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

function hasVisibleTabContent() {
  if (splitMode) {
    return splitPaneTabIds.some((id) => openTabs.some((t) => t.id === id));
  }
  return openTabs.some((t) => t.id === activeTabId);
}

function renderTabBar() {
  if (tabDragState) return;
  const barRow = $("tab-bar").parentNode;
  const hasContent = hasVisibleTabContent();
  if (splitMode) {
    barRow.style.display = "none";
    updateEmptyPlaceholder(!hasContent);
    return;
  }
  const bar = $("tab-bar");
  const items = openTabs.map((tab, i) => ({ type: "tab", tab, index: i }));
  for (const s of disconnectedSessions) {
    items.push({ type: "orphan", orphan: s, index: s.tabIndex != null ? s.tabIndex : items.length });
  }
  items.sort((a, b) => a.index - b.index);

  const hasAnyTabs = openTabs.length > 0 || disconnectedSessions.length > 0;
  persistOpenTabs();
  barRow.style.display = hasAnyTabs ? "flex" : "none";
  updateEmptyPlaceholder(!hasContent);
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
      const suffix = panelBottom ? "" : `${escapeHtml(label)}<span class="tab-close" data-close-orphan="${escapeHtml(s.wsUrl)}">&times;</span>`;
      html += `<button class="tab-btn orphan" data-orphan-url="${escapeHtml(s.wsUrl)}" data-orphan-ws="${escapeHtml(s.workspace || "")}">${owsIconHtml}${orphanIcon}${suffix}</button>`;
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
    bindLongPress(btn, {
      onLongPress: () => {
        const label = btn.dataset.orphanWs || "terminal";
        if (confirm(`「${label}」を閉じますか？`)) {
          const wsUrl = btn.dataset.orphanUrl;
          disconnectedSessions = disconnectedSessions.filter((s) => s.wsUrl !== wsUrl);
          closedSessionUrls.add(wsUrl);
          renderTabBar();
        }
      },
      onClick: (e) => {
        if (e.target.classList.contains("tab-close")) return;
        const wsUrl = btn.dataset.orphanUrl;
        const orphan = disconnectedSessions.find((s) => s.wsUrl === wsUrl);
        const workspace = btn.dataset.orphanWs;
        relaunchExpiredOrphan(orphan || { wsUrl, workspace }, workspace);
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
    if (existing) existing.remove();
    const ph = document.createElement("div");
    ph.className = "empty-tab-placeholder";
    const orphanCount = disconnectedSessions.filter((s) => s && s.wsUrl && !closedSessionUrls.has(s.wsUrl)).length;
    const hiddenWorkspaceCount = allWorkspaces.filter((ws) => ws.hidden).length;
    const restoreBtnHtml = orphanCount > 0
      ? `<button type="button" class="empty-tab-open-btn empty-tab-restore-btn" data-restore-all="1"><span class="mdi mdi-restore"></span> 全て復元 (${orphanCount})</button>`
      : "";
    const restoreVisibilityBtnHtml = hiddenWorkspaceCount > 0 && visibleWorkspaces().length === 0
      ? `<button type="button" class="empty-tab-open-btn empty-tab-restore-btn" data-restore-hidden-workspaces="1"><span class="mdi mdi-eye-refresh"></span> 全て復元 (${hiddenWorkspaceCount})</button>`
      : "";
    ph.innerHTML = `<div class="empty-tab-actions"><button type="button" class="empty-tab-open-btn"><span class="mdi mdi-plus"></span> ワークスペースを開く</button>${restoreBtnHtml}${restoreVisibilityBtnHtml}</div>`;
    ph.querySelector(".empty-tab-open-btn:not(.empty-tab-restore-btn)").addEventListener("click", () => openTabEditModal("open"));
    const restoreBtn = ph.querySelector("[data-restore-all='1']");
    if (restoreBtn) {
      restoreBtn.addEventListener("click", () => restoreAllOrphansFromPlaceholder(restoreBtn));
    }
    const restoreHiddenBtn = ph.querySelector("[data-restore-hidden-workspaces='1']");
    if (restoreHiddenBtn) {
      restoreHiddenBtn.addEventListener("click", () => restoreAllHiddenWorkspacesWithButton(restoreHiddenBtn));
    }
    container.appendChild(ph);
    if (outputArea) outputArea.style.display = "none";
  } else {
    if (existing) existing.remove();
    if (outputArea) outputArea.style.display = "";
  }
}

async function restoreAllOrphansFromPlaceholder(buttonEl) {
  if (!buttonEl || buttonEl.disabled) return;
  const targets = disconnectedSessions.filter((s) => s && s.wsUrl && !closedSessionUrls.has(s.wsUrl));
  if (!targets.length) return;
  buttonEl.disabled = true;
  const originalText = buttonEl.innerHTML;
  buttonEl.innerHTML = '<span class="mdi mdi-loading mdi-spin"></span> 復元中...';

  let relaunchedCount = 0;
  let failedCount = 0;

  for (const orphan of targets) {
    try {
      await relaunchExpiredOrphan(orphan, orphan.workspace);
      relaunchedCount += 1;
    } catch (e) {
      failedCount += 1;
      console.warn("restore orphan failed:", e);
    }
  }

  renderTabBar();
  const summary = `復元 ${relaunchedCount}件${failedCount ? ` / 失敗 ${failedCount}件` : ""}`;
  showToast(summary, failedCount ? "error" : "success");
  if (!document.body.contains(buttonEl)) return;
  buttonEl.innerHTML = originalText;
  buttonEl.disabled = false;
}

async function restoreAllHiddenWorkspacesWithButton(buttonEl, afterRestore = null) {
  if (!buttonEl || buttonEl.disabled) return;
  buttonEl.disabled = true;
  const originalText = buttonEl.innerHTML;
  buttonEl.innerHTML = '<span class="mdi mdi-loading mdi-spin"></span> 復元中...';
  try {
    const { restored, failed } = await restoreAllWorkspaceVisibility();
    await loadWorkspaces();
    if (typeof afterRestore === "function") {
      await afterRestore({ restored, failed });
    } else {
      renderTabBar();
    }
    const summary = `復元 ${restored}件${failed ? ` / 失敗 ${failed}件` : ""}`;
    showToast(summary, failed ? "error" : "success");
  } catch (e) {
    showToast(e.message || "復元に失敗しました", "error");
  }
  if (!document.body.contains(buttonEl)) return;
  buttonEl.innerHTML = originalText;
  buttonEl.disabled = false;
}

function createTabNamePill(tab, frame) {
  const pill = document.createElement("div");
  pill.className = "tab-name-pill" + (tab._activity ? " tab-activity" : "");
  const info = document.createElement("span");
  info.className = "tab-name-pill-info";
  info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tab.label || "");
  pill.appendChild(info);
  bindLongPress(pill, {
    onLongPress: () => {
      if (tab.type === "terminal") {
        const f = $(`frame-${tab.id}`);
        if (f && f.classList.contains("view-mode")) {
          exitTerminalViewMode(tab.id);
        } else {
          tab.term && tab.term.scrollToBottom();
          enterTerminalViewMode(tab.id);
        }
      }
    },
    onClick: () => {
      if (tab.type === "terminal") {
        const f = $(`frame-${tab.id}`);
        if (f && f.classList.contains("view-mode")) {
          exitTerminalViewMode(tab.id);
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
  const pill = frame.querySelector(".tab-name-pill");
  if (pill) {
    pill.classList.toggle("tab-activity", !!tab._activity);
  }
  const info = frame.querySelector(".tab-name-pill-info");
  if (info) {
    info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tab.label || "");
  }
}
