// @ts-check
import { openTabs, activeTabId, setActiveTabId, splitMode, splitPaneTabIds, setSplitPaneTabIds, activePaneIndex, setActivePaneIndex, splitLayout, setSplitLayout, disconnectedSessions, setDisconnectedSessions, closedSessionUrls, allWorkspaces, panelBottom, selectedWorkspace } from './state-core.js';
import { $, setupModalSwipeClose, escapeHtml, showToast, renderIcon } from './utils.js';
import { persistOpenTabs, tabDisplayName, switchTab, removeTab, renderTabBar, syncWorkspaceForTab, updateHeaderForTab, relaunchExpiredOrphan, updateGitBarVisibility, renderTabIconHtml } from './terminal-tabs.js';
import { syncTerminalSessionState } from './terminal-connection.js';
import { enterSplitMode, rebuildSplitLayout, exitSplitMode, exitSplitModeWithTab, selectActivePane as setSplitActivePaneIndex, clearSplitDom, buildSplitDom, fitAllSplitTerminals } from './terminal-split.js';
import { createTerminalTabModalWorkspaceSection } from './terminal-tab-modal-workspace.js';
import { GitLogModal } from './git-log-modal.js';
import { runJob } from './jobs.js';
import { renderTerminalSettingsPane } from './settings-terminal.js';
import { renderWorkspaceSettingsPane } from './settings-workspace.js';
import { renderProcessListTo, renderOpLogTo, renderActivityLogTo, renderServerInfoTo, exportSettings, importSettings } from './settings.js';

/**
 * Opens the tab/settings edit modal overlay.
 * @param {string} [initialTab="layout"] - The tab key to show initially.
 */
export function openTabEditModal(initialTab = "layout") {
  let overlay = document.getElementById("split-tab-modal-overlay");
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.id = "split-tab-modal-overlay";
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal split-tab-modal";

  const header = document.createElement("div");
  header.className = "modal-header";
  const titleEl = document.createElement("h3");
  titleEl.id = "split-modal-title";
  titleEl.textContent = "ワークスペース";
  header.appendChild(titleEl);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => closeModal());
  header.appendChild(closeBtn);

  modal.appendChild(header);

  const scrollBody = document.createElement("div");
  scrollBody.className = "modal-scroll-body split-tab-scroll";
  modal.appendChild(scrollBody);

  /**
   * Sets the modal title, optionally with a back button.
   * @param {string} text
   * @param {(() => void) | null} [backFn]
   */
  function setTitle(text, backFn) {
    titleEl.textContent = "";
    titleEl.className = "";
    if (backFn) {
      titleEl.className = "split-modal-title-back";
      const arrow = document.createElement("span");
      arrow.className = "mdi mdi-arrow-left";
      titleEl.appendChild(arrow);
      titleEl.appendChild(document.createTextNode(" " + text));
      titleEl.style.cursor = "pointer";
      titleEl.onclick = backFn;
    } else {
      titleEl.textContent = text;
      titleEl.style.cursor = "";
      titleEl.onclick = null;
    }
  }

  const contentContainer = document.createElement("div");
  contentContainer.className = "split-tab-content";
  scrollBody.appendChild(contentContainer);
  const workspaceSection = createTerminalTabModalWorkspaceSection({
    contentContainer,
    switchModalTab,
    closeModal,
    setTitle,
    showMainView,
  });

  overlay.appendChild(modal);
  $("app-screen").appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  setupModalSwipeClose(overlay, closeModal);

  /** Shows the main settings view. */
  function showMainView() {
    contentContainer.innerHTML = "";
    setTitle("設定");
    renderSettingsTab(contentContainer);
  }

  /**
   * Switches to a named modal tab.
   * @param {string} key
   */
  function switchModalTab(key) {
    contentContainer.innerHTML = "";
    if (key === "settings") {
      showMainView();
    } else {
      renderSubPane(key);
    }
  }

  /**
   * Renders a named sub-pane inside the modal.
   * @param {string} key
   */
  function renderSubPane(key) {
    const labels = {
      "open": "ワークスペース",
      "ws-add": "新規追加",
      "ws-visibility": "ワークスペース設定",
      "layout": "タブ",
    };
    setTitle(labels[key] || key, () => switchModalTab("settings"));
    if (key === "open") renderOpenTab();
    else if (key === "ws-visibility") showPickerCloneInContainer(contentContainer, "visibility");
    else if (key === "ws-add") showPickerCloneInContainer(contentContainer, "add");
    else if (key === "layout") renderLayoutTab(contentContainer);
  }

  /** @type {HTMLButtonElement[]} */
  const modeBtns = [];

  /**
   * Renders the layout (split mode) tab into the given target element.
   * @param {HTMLElement} target
   */
  function renderLayoutTab(target) {
    const container = target || contentContainer;
    const tabCount = openTabs.length;
    const modeRow = document.createElement("div");
    modeRow.className = "split-tab-mode-row";
    modeBtns.length = 0;

    const modes = [
      { value: "normal", icon: "split-icon-normal", minTabs: 0 },
      { value: "vertical", icon: "split-icon-v", minTabs: 1 },
      { value: "horizontal", icon: "split-icon-h", minTabs: 1 },
      { value: "grid", icon: "split-icon-grid", minTabs: 3 },
    ];
    for (const m of modes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.mode = m.value;
      const iconEl = document.createElement("span");
      iconEl.className = m.icon;
      btn.appendChild(iconEl);
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        if (m.value === "normal") {
          if (splitMode) { exitSplitMode(); updateModeRadio(); renderTabList(); }
        } else {
          setSplitLayout(m.value);
          if (!splitMode) { enterSplitMode(); } else { rebuildSplitLayout(); }
          updateModeRadio();
          renderTabList();
        }
      });
      modeBtns.push(btn);
      modeRow.appendChild(btn);
    }

    container.appendChild(modeRow);
    updateModeRadio();

    const list = document.createElement("div");
    list.className = "modal-scroll-body split-tab-list";
    container.appendChild(list);
    renderTabList();
  }

  /** Updates the split mode radio button visual state. */
  function updateModeRadio() {
    const current = splitMode ? splitLayout : "normal";
    for (const b of modeBtns) {
      b.className = "split-tab-mode-option" + (b.dataset.mode === current ? " active" : "");
    }
  }

  /** @type {{ idx: number, startY: number, offsetY: number, rowHeight: number } | null} */
  let dragState = null;

  /**
   * Enters split mode with the given tab as the secondary pane.
   * @param {string} tabId
   */
  function switchToSplitModeWithTab(tabId) {
    if (splitMode) return;
    const targetTab = openTabs.find((t) => t.id === tabId);
    if (!targetTab) return;
    const currentActive = openTabs.find((t) => t.id === activeTabId);
    const baseTabId = currentActive ? currentActive.id : openTabs[0]?.id;
    if (!baseTabId) return;

    if (splitLayout === "grid") setSplitLayout("vertical");
    enterSplitMode();
    if (!splitPaneTabIds.includes(tabId)) splitPaneTabIds.push(tabId);
    setActivePaneIndex(Math.max(0, splitPaneTabIds.indexOf(tabId)));
    setActiveTabId(splitPaneTabIds[activePaneIndex] || baseTabId);
    rebuildSplitLayout();
    updateModeRadio();
    renderTabList();
  }

  /**
   * Toggles a tab row's inclusion in the split pane, or switches to it.
   * @param {{ id: string }} tab
   */
  function toggleRow(tab) {
    if (splitMode) {
      const included = splitPaneTabIds.includes(tab.id);
      if (included) {
        setSplitPaneTabIds(splitPaneTabIds.filter((id) => id !== tab.id));
        const frame = $(`frame-${tab.id}`);
        if (frame) frame.style.display = "none";
        if (splitLayout === "grid" && splitPaneTabIds.length < 3) {
          setSplitLayout("vertical");
        }
      } else {
        splitPaneTabIds.push(tab.id);
      }
      if (splitPaneTabIds.length >= 1) {
        if (activePaneIndex >= splitPaneTabIds.length) setActivePaneIndex(0);
        setActiveTabId(splitPaneTabIds[activePaneIndex]);
        const container = $("output-container");
        clearSplitDom(container);
        container.classList.remove("split-active", "split-mobile", "split-vertical", "split-horizontal");
        buildSplitDom();
        fitAllSplitTerminals();
      }
      renderTabBar();
      updateModeRadio();
      renderTabList();
    } else {
      switchTab(tab.id);
      renderTabList();
    }
  }

  /**
   * Relaunches an orphan (disconnected) session row.
   * @param {{ workspace: string }} orphan
   * @returns {null}
   */
  function openOrphanRow(orphan) {
    relaunchExpiredOrphan(orphan, orphan.workspace);
    return null;
  }

  /** Renders the list of open tabs and orphan sessions. */
  function renderTabList() {
    persistOpenTabs();
    const list = contentContainer.querySelector(".split-tab-list");
    if (!list) return;
    list.innerHTML = "";

    /**
     * Renders a single open tab row.
     * @param {{ id: string, label?: string }} tab
     * @param {number} tabIndex
     */
    function renderTabRow(tab, tabIndex) {
      const row = document.createElement("div");
      row.className = "split-tab-row";
      row.dataset.idx = tabIndex;
      if (!splitMode && tab.id === activeTabId) row.classList.add("active");

      const inputWrap = document.createElement("span");
      inputWrap.className = "split-tab-input-wrap";
      const isActiveTab = tab.id === activeTabId;
      const isIncluded = splitPaneTabIds.includes(tab.id);

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.className = "split-tab-input";
      radio.checked = isActiveTab;
      radio.disabled = false;
      radio.addEventListener("click", (e) => {
        e.stopPropagation();
        if (splitMode) {
          exitSplitMode();
        }
        switchTab(tab.id);
        updateModeRadio();
        renderTabList();
      });
      inputWrap.appendChild(radio);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "split-tab-input";
      checkbox.checked = isIncluded;
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        if (splitMode) {
          toggleRow(tab);
          return;
        }
        if (isActiveTab) return;
        switchToSplitModeWithTab(tab.id);
      });
      inputWrap.appendChild(checkbox);

      const handle = document.createElement("span");
      handle.className = "split-tab-drag-handle";
      handle.innerHTML = '<span class="mdi mdi-drag"></span>';
      bindDragHandle(handle, row, tabIndex, list);
      row.appendChild(handle);
      row.appendChild(inputWrap);

      const info = document.createElement("span");
      info.className = "split-tab-row-info";
      info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tabDisplayName(tab) || tab.label || "");
      info.addEventListener("click", (e) => {
        e.stopPropagation();
        if (splitMode) {
          exitSplitModeWithTab(tab.id);
          updateModeRadio();
          renderTabList();
          return;
        }
        switchTab(tab.id);
        renderTabList();
      });
      row.appendChild(info);

      row.addEventListener("click", (e) => {
        if (e.target.closest(".split-tab-drag-handle")) return;
        if (e.target.closest(".split-tab-close-btn")) return;
        if (e.target.closest(".split-tab-input")) return;
        if (splitMode) {
          const idx = splitPaneTabIds.indexOf(tab.id);
          if (idx >= 0) {
            setSplitActivePaneIndex(idx);
            renderTabList();
          }
          return;
        }
        toggleRow(tab);
      });

      const closeBtnEl = document.createElement("button");
      closeBtnEl.type = "button";
      closeBtnEl.className = "split-tab-close-btn";
      closeBtnEl.innerHTML = "&times;";
      closeBtnEl.addEventListener("click", () => {
        removeTab(tab.id);
        if (!document.body.contains(contentContainer)) return;
        updateModeRadio();
        renderTabList();
      });
      row.appendChild(closeBtnEl);

      list.appendChild(row);
    }

    /**
     * Renders a single orphan (disconnected) session row.
     * @param {{ wsUrl: string, workspace?: string, tabIndex?: number, icon?: string, iconColor?: string }} s
     */
    function renderOrphanRow(s) {
      const row = document.createElement("div");
      row.className = "split-tab-row split-tab-row-orphan";

      const inputWrap = document.createElement("span");
      inputWrap.className = "split-tab-input-wrap";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.className = "split-tab-input";
      radio.checked = false;
      radio.addEventListener("click", (e) => {
        e.stopPropagation();
        openOrphanRow(s);
        renderTabList();
        updateModeRadio();
      });
      inputWrap.appendChild(radio);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "split-tab-input";
      checkbox.checked = false;
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        openOrphanRow(s);
        renderTabList();
        updateModeRadio();
      });
      inputWrap.appendChild(checkbox);
      row.appendChild(inputWrap);

      const handle = document.createElement("span");
      handle.className = "split-tab-drag-handle";
      handle.style.visibility = "hidden";
      row.appendChild(handle);

      const info = document.createElement("span");
      info.className = "split-tab-row-info";
      const ows = s.workspace ? allWorkspaces.find((w) => w.name === s.workspace) : null;
      const owsIconHtml = ows && ows.icon ? renderIcon(ows.icon, ows.icon_color, 14) : "";
      const orphanIcon = s.icon ? renderIcon(s.icon, s.iconColor || "", 14) : "";
      info.innerHTML = owsIconHtml + orphanIcon + escapeHtml(s.workspace || "terminal");
      info.addEventListener("click", (e) => {
        e.stopPropagation();
        openOrphanRow(s);
        renderTabList();
        updateModeRadio();
      });
      row.appendChild(info);

      row.addEventListener("click", (e) => {
        if (e.target.closest(".split-tab-close-btn")) return;
        if (e.target.closest(".split-tab-input")) return;
        openOrphanRow(s);
        renderTabList();
        updateModeRadio();
      });

      const closeBtnEl = document.createElement("button");
      closeBtnEl.type = "button";
      closeBtnEl.className = "split-tab-close-btn";
      closeBtnEl.innerHTML = "&times;";
      closeBtnEl.addEventListener("click", () => {
        const label = s.workspace || "terminal";
        if (!confirm(`「${label}」を閉じますか？`)) return;
        setDisconnectedSessions(disconnectedSessions.filter((o) => o.wsUrl !== s.wsUrl));
        closedSessionUrls.add(s.wsUrl);
        renderTabList();
      });
      row.appendChild(closeBtnEl);

      list.appendChild(row);
    }

    const items = openTabs.map((tab, i) => ({
      type: "tab",
      tab,
      tabIndex: i,
      sortIndex: i,
    }));
    disconnectedSessions.forEach((s, i) => {
      const sortIndex = s.tabIndex != null ? s.tabIndex : openTabs.length + i;
      items.push({ type: "orphan", orphan: s, sortIndex });
    });
    items.sort((a, b) => a.sortIndex - b.sortIndex);
    for (const item of items) {
      if (item.type === "tab") renderTabRow(item.tab, item.tabIndex);
      else renderOrphanRow(item.orphan);
    }
  }

  /**
   * Binds drag-to-reorder behaviour to a drag handle element.
   * @param {HTMLElement} handle
   * @param {HTMLElement} row
   * @param {number} idx
   * @param {HTMLElement} list
   */
  function bindDragHandle(handle, row, idx, list) {
    /** @param {MouseEvent | TouchEvent} e */
    function onStart(e) {
      e.preventDefault();
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const rowRect = row.getBoundingClientRect();
      dragState = { idx, startY: y, offsetY: y - rowRect.top, rowHeight: rowRect.height };
      row.classList.add("dragging");
      row.style.position = "relative";
      row.style.zIndex = "10";

      /** @param {MouseEvent | TouchEvent} ev */
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
          moveTab(dragState.idx, targetIdx, list);
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
        applyTabOrder(list);
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

  /**
   * Moves a tab row in the DOM from one index to another.
   * @param {number} fromIdx
   * @param {number} toIdx
   * @param {HTMLElement} list
   */
  function moveTab(fromIdx, toIdx, list) {
    if (fromIdx === toIdx) return;
    const rows = Array.from(list.children);
    const row = rows[fromIdx];
    if (toIdx > fromIdx) {
      list.insertBefore(row, rows[toIdx].nextSibling);
    } else {
      list.insertBefore(row, rows[toIdx]);
    }
  }

  /**
   * Applies the current DOM row order back to the openTabs array.
   * @param {HTMLElement} list
   */
  function applyTabOrder(list) {
    const rows = Array.from(list.children);
    const newOrder = rows.map((r) => openTabs[parseInt(r.dataset.idx)]).filter(Boolean);

    openTabs.length = 0;
    openTabs.push(...newOrder);

    if (splitMode) {
      setSplitPaneTabIds(newOrder.map((t) => t.id));
      setActivePaneIndex(splitPaneTabIds.indexOf(activeTabId));
      rebuildSplitLayout();
    } else {
      renderTabBar();
    }
  }

  /** Delegates to workspaceSection to render the open-tab workspace list. */
  function renderOpenTab() {
    workspaceSection.renderOpenTab();
  }

  /**
   * Delegates to workspaceSection to render the workspace list into a container.
   * @param {HTMLElement} container
   */
  function renderModalWsList(container) {
    workspaceSection.renderModalWsList(container);
  }

  /**
   * Renders the settings tab into the given target element.
   * @param {HTMLElement} target
   */
  function renderSettingsTab(target) {
    const container = target || contentContainer;
    renderSettingsMenu(container);
  }

  /**
   * Renders the top-level settings menu.
   * @param {HTMLElement} target
   */
  function renderSettingsMenu(target) {
    const container = target || contentContainer;
    container.innerHTML = "";
    const menu = document.createElement("div");
    menu.className = "settings-menu";

    const items = [
      { icon: "mdi-console", label: "ワークスペース", action: () => switchModalTab("open") },
      { icon: "mdi-eye", label: "ワークスペース設定", action: () => switchModalTab("ws-visibility") },
      { icon: "mdi-plus", label: "ワークスペース追加", action: () => switchModalTab("ws-add") },
      { icon: "mdi-tab", label: "タブ", action: () => switchModalTab("layout") },
      { icon: "mdi-format-font-size-increase", label: "ターミナル", action: () => showModalSubView("ターミナル", (body) => renderTerminalSettingsPane(body, { onBack: () => switchModalTab("settings") })) },
      { icon: "mdi-download", label: "設定エクスポート", action: () => exportSettings() },
      { icon: "mdi-upload", label: "設定インポート", action: () => importSettings() },
      { icon: "mdi-format-list-bulleted", label: "プロセス一覧", action: () => showModalSubView("プロセス一覧", renderProcessListTo) },
      { icon: "mdi-information-outline", label: "サーバー情報", action: () => showModalSubView("サーバー情報", renderServerInfoTo) },
      { icon: "mdi-text-box-outline", label: "操作ログ", action: () => showModalSubView("操作ログ", renderActivityLogTo) },
      { icon: "mdi-history", label: "ネットワークログ", action: () => showModalSubView("ネットワークログ", renderOpLogTo) },
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

  /**
   * Shows a sub-view inside the modal by clearing content and calling a render function.
   * @param {string} subTitle
   * @param {(body: HTMLElement) => void} renderFn
   */
  function showModalSubView(subTitle, renderFn) {
    contentContainer.innerHTML = "";
    setTitle(subTitle, () => switchModalTab("settings"));
    const body = document.createElement("div");
    body.className = "split-tab-settings-body";
    contentContainer.appendChild(body);
    renderFn(body);
  }

  /**
   * Delegates to workspaceSection to show the picker/clone UI in the content container.
   * @param {HTMLElement} content
   * @param {string} [defaultTab="github"]
   */
  function showPickerCloneInContainer(content, defaultTab = "github") {
    workspaceSection.showPickerCloneInContainer(content, defaultTab);
  }

  /** Removes the modal overlay from the DOM. */
  function closeModal() {
    overlay.remove();
  }

  if (initialTab === "workspace") switchModalTab("open");
  else if (initialTab === "settings" || initialTab === "open") showMainView();
  else switchModalTab(initialTab);
}
