// @ts-check
import { openTabs, activeTabId, splitMode, splitPaneTabIds, setSplitPaneTabIds, activePaneIndex, setActivePaneIndex, setActiveTabId, splitLayout, setSplitLayout, orphanSessions, setOrphanSessions, closedSessionUrls, allWorkspaces } from './state-core.js';
import { escapeHtml, renderIcon } from './utils.js';
import { tabDisplayName, renderTabIconHtml } from './terminal-tab-utils.js';
import { switchTab, removeTab, renderTabBar, relaunchExpiredOrphan } from './terminal-tabs.js';
import { enterSplitMode, rebuildSplitLayout, exitSplitMode, exitSplitModeWithTab, selectActivePane as setSplitActivePaneIndex, clearSplitDom, buildSplitDom, fitAllSplitTerminals } from './terminal-split.js';

/**
 * Creates a tab list renderer bound to modal lifecycle callbacks.
 * @param {{ updateModeRadio: () => void, contentContainer: HTMLElement, closeModal: () => void }} deps
 * @returns {{ renderTabList: () => void, toggleRow: (tab: { id: string }) => void, switchToSplitModeWithTab: (tabId: string) => void }}
 */
export function createTabListRenderer(deps) {
  const { updateModeRadio, contentContainer, closeModal } = deps;

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
        const frame = document.getElementById(`frame-${tab.id}`);
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
        const container = document.getElementById("output-container");
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
        if (openTabs.length === 0 && orphanSessions.length === 0) {
          closeModal();
          return;
        }
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
        setOrphanSessions(orphanSessions.filter((o) => o.wsUrl !== s.wsUrl));
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
    orphanSessions.forEach((s, i) => {
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

  return { renderTabList, toggleRow, switchToSplitModeWithTab };
}
