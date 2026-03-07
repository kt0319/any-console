// @ts-check
import { openTabs, setOpenTabs, activeTabId, setActiveTabId, splitMode, splitPaneTabIds, setSplitPaneTabIds, activePaneIndex, setActivePaneIndex, allWorkspaces, orphanSessions, setOrphanSessions, closedSessionUrls, panelBottom, isTouchDevice, terminalIdCounter, setTerminalIdCounter, getTerminalRuntimeOptions } from './state-core.js';
import { renderIcon, escapeHtml, bindLongPress, showToast, $, refitTerminalWithFocus, setFrameVisible } from './utils.js';
import { tabDisplayName, renderTabIconHtml, hasVisibleTabContent } from './terminal-tab-utils.js';
import { syncWorkspaceForTab, updateHeaderForTab, updateGitBarVisibility } from './terminal-tab-header.js';
// Circular deps (only used inside function bodies):
import { deleteTerminalSession, connectTerminalWs, syncTerminalSessionState, updateQuickInputVisibility, ensureTerminalOpened } from './terminal-connection.js';
import { exitAllViewModes } from './terminal-view-mode.js';
import { rebuildSplitLayout, exitSplitModeWithTab } from './terminal-split.js';
import { loadWorkspaces, visibleWorkspaces } from './workspace.js';
import { openTabEditModal } from './terminal-tab-modal.js';
import { createTabNamePill, refreshTabNamePill } from './terminal-tab-pill.js';
import { tabDragState, bindMouseDrag } from './terminal.js';
import { updateDocumentTitle } from './auth.js';
import { restoreAllWorkspaceVisibility } from './settings-workspace.js';
import { showKeyboardInput } from './viewport.js';

// Re-export from extracted modules for backward compatibility
export { tabDisplayName, renderTabIconHtml, resolveWorkspaceNameForTab, hasVisibleTabContent } from './terminal-tab-utils.js';
export { syncWorkspaceForTab, updateHeaderForTab, updateGitBarVisibility } from './terminal-tab-header.js';

/**
 * Relaunches an expired orphan terminal session.
 * まず旧wsUrlへの再接続を試み（サーバー再起動後のtmux復帰）、
 * 失敗時は新規セッション作成にフォールバックする。
 * @param {any} orphan
 * @param {string|null} [workspaceOverride]
 * @returns {void}
 */
export function relaunchExpiredOrphan(orphan, workspaceOverride = null) {
  if (!orphan) return;
  const workspace = workspaceOverride || orphan.workspace || null;
  setOrphanSessions(orphanSessions.filter((s) => s.wsUrl !== orphan.wsUrl));

  const tabIcon = orphan.icon ? { name: orphan.icon, color: orphan.iconColor || "" } : null;
  const ws = workspace ? allWorkspaces.find((w) => w.name === workspace) : null;
  const wsIcon = ws && ws.icon ? { name: ws.icon, color: ws.icon_color || "" } : null;
  addTerminalTab(orphan.wsUrl, workspace, null, true, false, null, tabIcon, wsIcon, orphan.jobName || null, orphan.jobLabel || null);
  const tab = openTabs.find((t) => t.wsUrl === orphan.wsUrl);
  if (tab) {
    tab._orphanReconnect = true;
    syncTerminalSessionState();
    switchTab(tab.id);
  }
}

/**
 * Adds a new terminal tab to the UI.
 * @param {string} wsUrl
 * @param {string|null} workspace
 * @param {string|null} tabId
 * @param {boolean} [skipSwitch]
 * @param {boolean} [restored]
 * @param {string|null} [initialCommand]
 * @param {any} [tabIcon]
 * @param {any} [wsIcon]
 * @param {string|null} [jobName]
 * @param {string|null} [jobLabel]
 * @returns {void}
 */
export function addTerminalTab(wsUrl, workspace, tabId, skipSwitch, restored, initialCommand, tabIcon, wsIcon, jobName, jobLabel) {
  const id = tabId || `term-${terminalIdCounter + 1}`;
  if (!tabId) setTerminalIdCounter(terminalIdCounter + 1);
  if (tabId) {
    const m = tabId.match(/^term-(\d+)$/);
    if (m) setTerminalIdCounter(Math.max(terminalIdCounter, parseInt(m[1])));
  }
  const label = workspace || "terminal";
  if (openTabs.some((t) => t.id === id)) return;

  const container = document.createElement("div");
  container.className = "terminal-frame";
  container.id = `frame-${id}`;
  container.style.display = "none";
  $("output-container").appendChild(container);

  const term = new Terminal({
    ...getTerminalRuntimeOptions(),
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

  let mutationObserver = null;
  if (isTouchDevice) {
    const patchTextarea = () => {
      const ta = container.querySelector("textarea");
      if (!ta || ta._focusPatched) return;
      ta._focusPatched = true;
      const origFocus = ta.focus.bind(ta);
      ta.focus = (opts) => { if (!splitMode) origFocus(opts); };
    };
    mutationObserver = new MutationObserver(patchTextarea);
    mutationObserver.observe(container, { childList: true, subtree: true });
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


  const tab = { id, type: "terminal", wsUrl, workspace: workspace || null, label, term, fitAddon, ws: null, _initialCommand: initialCommand || null, icon: tabIcon || null, wsIcon: wsIcon || null, jobName: jobName || null, jobLabel: jobLabel || null, _pendingOpen: true, _pendingRedraw: !!restored, _mutationObserver: mutationObserver };
  openTabs.push(tab);
  createTabNamePill(tab, container);


  if (skipSwitch) return;
  syncTerminalSessionState();
  switchTab(id);
}

/**
 * Removes a tab by ID, optionally preserving its session for later restore.
 * @param {string} id
 * @param {{ preserveSessionForRestore?: boolean }} [options]
 * @returns {void}
 */
export function removeTab(id, options = {}) {
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
    if (tab._mutationObserver) tab._mutationObserver.disconnect();
    if (tab.ws) tab.ws.close();
    if (tab.fitAddon) try { tab.fitAddon.dispose(); } catch (e) { console.warn("fitAddon.dispose failed:", e); }
    if (tab.term) tab.term.dispose();
  }
  setOpenTabs(openTabs.filter((t) => t.id !== id));
  const el = $(`frame-${id}`);
  if (el) el.remove();

  syncTerminalSessionState();

  if (splitMode) {
    if (openTabs.length === 0) {
      exitSplitModeWithTab(null);
      updateHeaderForTab(null);
      return;
    }
    rebuildSplitLayout();
    return;
  }

  if (openTabs.length === 0) {
    setActiveTabId(null);
    renderTabBar();
    updateHeaderForTab(null);
  } else if (activeTabId === id) {
    const next = openTabs[openTabs.length - 1].id;
    switchTab(next);
  } else {
    renderTabBar();
  }
}

/**
 * Switches the active tab to the given tab ID.
 * @param {string|null} id
 * @returns {Promise<void>}
 */
export async function switchTab(id) {
  if (splitMode) {
    const switchedTab = openTabs.find((t) => t.id === id);
    if (switchedTab) {
      switchedTab._activity = false;
      refreshTabNamePill(switchedTab);
    }

    const needsRebuild = openTabs.length !== splitPaneTabIds.length ||
      openTabs.some((t) => !splitPaneTabIds.includes(t.id));
    if (needsRebuild) {
      setSplitPaneTabIds(openTabs.map((t) => t.id));
      const idx = splitPaneTabIds.indexOf(id);
      setActivePaneIndex(idx >= 0 ? idx : 0);
      setActiveTabId(splitPaneTabIds[activePaneIndex]);
      rebuildSplitLayout();
    } else {
      const paneIdx = splitPaneTabIds.indexOf(id);
      if (paneIdx >= 0) setActivePaneIndex(paneIdx);
    }
    updateHeaderForTab(activeTabId);
    return;
  }

  exitAllViewModes();

  setActiveTabId(id);
  const switchedTab = openTabs.find((t) => t.id === id);
  if (switchedTab) {
    switchedTab._activity = false;
    refreshTabNamePill(switchedTab);
  }
  if (document.title.startsWith("* ")) {
    document.title = document.title.slice(2);
  }
  syncWorkspaceForTab(id);
  updateDocumentTitle();

  $("output").style.display = id === null ? "" : "none";
  for (const tab of openTabs) {
    const el = $(`frame-${tab.id}`);
    if (el) {
      const isActive = tab.id === id;
      setFrameVisible(tab, el, isActive);
      if (isActive && tab.type === "terminal" && !ensureTerminalOpened(tab, el)) {
        if (!tab.ws && !tab._wsDisposed) {
          tab._replacedByOtherDevice = false;
          connectTerminalWs(tab);
        }
        refitTerminalWithFocus(tab);
      }
    }
  }
  updateQuickInputVisibility();
  renderTabBar();

  updateHeaderForTab(id);
}

/**
 * Renders the tab bar UI, including open tabs and orphan (disconnected) session entries.
 * @returns {void}
 */
export function renderTabBar() {
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
  for (const s of orphanSessions) {
    items.push({ type: "orphan", orphan: s, index: s.tabIndex != null ? s.tabIndex : items.length });
  }
  items.sort((a, b) => a.index - b.index);

  const hasAnyTabs = openTabs.length > 0 || orphanSessions.length > 0;

  const showBarRow = hasAnyTabs || isTouchDevice || panelBottom;
  barRow.style.display = showBarRow ? "flex" : "none";
  updateEmptyPlaceholder(!hasContent);
  updateQuickInputVisibility();
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

  if (!bar._dblclickBound) {
    bar.addEventListener("dblclick", (e) => {
      if (!e.target.closest(".tab-btn")) openTabEditModal("workspace");
    });
    bar._dblclickBound = true;
  }

  bar.querySelectorAll(".tab-btn:not(.orphan)").forEach((btn) => {
    const tab = openTabs.find((t) => t.id === btn.dataset.tab);
    bindLongPress(btn, {
      onLongPress: () => {
        openTabEditModal();
      },
      onClick: (e) => {
        if (e.target.classList.contains("tab-close")) return;
        const tabId = btn.dataset.tab;
        if (tabId === activeTabId) {
          const tab = openTabs.find((t) => t.id === tabId);
          if (tab?.type === "terminal" && !tab.ws && !tab._wsDisposed && tab._replacedByOtherDevice) {
            tab._replacedByOtherDevice = false;
            connectTerminalWs(tab);
            return;
          }
          openTabEditModal("workspace");
          return;
        }
        switchTab(tabId);
      },
    });
    if (!panelBottom && tab) bindMouseDrag(btn, tab);
  });
  bar.querySelectorAll(".tab-btn.orphan").forEach((btn) => {
    bindLongPress(btn, {
      onLongPress: () => {
        const label = btn.dataset.orphanWs || "terminal";
        if (confirm(`「${label}」を閉じますか？`)) {
          const wsUrl = btn.dataset.orphanUrl;
          setOrphanSessions(orphanSessions.filter((s) => s.wsUrl !== wsUrl));
          closedSessionUrls.add(wsUrl);
          renderTabBar();
        }
      },
      onClick: (e) => {
        if (e.target.classList.contains("tab-close")) return;
        const wsUrl = btn.dataset.orphanUrl;
        const orphan = orphanSessions.find((s) => s.wsUrl === wsUrl);
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
        const orphan = orphanSessions.find((s) => s.wsUrl === wsUrl);
        const label = orphan?.workspace || "terminal";
        if (!confirm(`「${label}」を閉じますか？`)) return;
        setOrphanSessions(orphanSessions.filter((s) => s.wsUrl !== wsUrl));
        closedSessionUrls.add(wsUrl);
        renderTabBar();
      }
    });
  });
  const activeBtn = bar.querySelector(".tab-btn.active");
  if (activeBtn) activeBtn.scrollIntoView({ inline: "nearest", block: "nearest" });
}

/**
 * Shows or hides the empty tab placeholder in the output container.
 * @param {boolean} show
 * @returns {void}
 */
export function updateEmptyPlaceholder(show) {
  const container = $("output-container");
  const outputArea = $("output");
  const existing = container.querySelector(".empty-tab-placeholder");
  if (show) {
    if (existing) existing.remove();
    const ph = document.createElement("div");
    ph.className = "empty-tab-placeholder";
    const orphanCount = orphanSessions.filter((s) => s && s.wsUrl && !closedSessionUrls.has(s.wsUrl)).length;
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

/**
 * Restores all orphan (disconnected) terminal sessions from the empty placeholder button.
 * @param {HTMLButtonElement} buttonEl
 * @returns {Promise<void>}
 */
export async function restoreAllOrphansFromPlaceholder(buttonEl) {
  if (!buttonEl || buttonEl.disabled) return;
  const targets = orphanSessions.filter((s) => s && s.wsUrl && !closedSessionUrls.has(s.wsUrl));
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

/**
 * Restores all hidden workspaces via the placeholder button, then optionally calls a callback.
 * @param {HTMLButtonElement} buttonEl
 * @param {((result: { restored: number, failed: number }) => Promise<void>)|null} [afterRestore]
 * @returns {Promise<void>}
 */
export async function restoreAllHiddenWorkspacesWithButton(buttonEl, afterRestore = null) {
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
