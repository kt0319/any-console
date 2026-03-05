// @ts-check
import { openTabs, splitMode, setSplitMode, splitPaneTabIds, setSplitPaneTabIds, activePaneIndex, setActivePaneIndex, activeTabId, setActiveTabId, panelBottom, splitLayout, setSplitLayout, isPaneSelectedByTap, setIsPaneSelectedByTap, isTouchDevice } from './state-core.js';
import { $, safeFit, refitTerminalWithFocus, fitAndSync } from './utils.js';
import { ensureTerminalOpened } from './terminal-connection.js';
import { renderTabBar, updateGitBarVisibility, switchTab, updateHeaderForTab, removeTab } from './terminal-tabs.js';
import { exitTerminalViewMode, exitAllViewModes, enterTerminalViewMode } from './terminal-view-mode.js';
import { showKeyboardInput } from './viewport.js';

/**
 * @param {number} count
 * @returns {number[]}
 */
function calcGridLayout(count) {
  if (count <= 1) return [count];
  const topRow = Math.ceil(count / 2);
  return [topRow, count - topRow];
}

export function enterSplitMode() {
  if (openTabs.length < 1) return;
  if (splitMode) return;

  setSplitMode(true);
  if (document.title.startsWith("* ")) {
    document.title = document.title.slice(2);
  }
  setIsPaneSelectedByTap(false);
  exitAllViewModes();
  const openTabIds = new Set(openTabs.map((t) => t.id));
  setSplitPaneTabIds(splitPaneTabIds.filter((id) => openTabIds.has(id)));
  if (activeTabId && openTabIds.has(activeTabId) && !splitPaneTabIds.includes(activeTabId)) {
    setSplitPaneTabIds([activeTabId, ...splitPaneTabIds]);
  }
  if (splitPaneTabIds.length === 0 && activeTabId && openTabIds.has(activeTabId)) {
    setSplitPaneTabIds([activeTabId]);
  }
  if (splitPaneTabIds.length > 0) {
    if (activePaneIndex >= splitPaneTabIds.length) setActivePaneIndex(0);
    setActiveTabId(splitPaneTabIds[activePaneIndex]);
    buildSplitDom();
    fitAllSplitTerminals();
  } else {
    setActivePaneIndex(0);
    for (const tab of openTabs) {
      const el = $(`frame-${tab.id}`);
      if (el) el.style.display = "none";
    }
  }
  renderTabBar();
  updateGitBarVisibility();
}

export function exitSplitMode() {
  exitSplitModeWithTab(activeTabId);
}

export function exitSplitModeWithTab(targetTabId) {
  if (!splitMode) return;

  const container = $("output-container");
  clearSplitDom(container);
  container.classList.remove("split-active", "split-mobile", "split-vertical", "split-horizontal");

  setSplitMode(false);
  if (splitPaneTabIds.length > 0) {
    const currentIdx = splitPaneTabIds.indexOf(targetTabId);
    setActivePaneIndex(currentIdx >= 0 ? currentIdx : Math.min(activePaneIndex, splitPaneTabIds.length - 1));
  } else {
    setActivePaneIndex(0);
  }

  const target = openTabs.find((t) => t.id === targetTabId) ? targetTabId : activeTabId;
  for (const tab of openTabs) {
    const el = $(`frame-${tab.id}`);
    if (el) {
      el.style.display = tab.id === target ? (tab.type === "terminal" ? "block" : "") : "none";
    }
  }

  switchTab(target);
}

export function rebuildSplitLayout() {
  if (!splitMode) return;
  blurAllTerminals();
  const container = $("output-container");
  clearSplitDom(container);
  container.classList.remove("split-active", "split-mobile", "split-vertical", "split-horizontal");

  if (openTabs.length === 0) {
    exitSplitModeWithTab(null);
    return;
  }

  const tabIds = new Set(openTabs.map((t) => t.id));
  setSplitPaneTabIds(splitPaneTabIds.filter((id) => tabIds.has(id)));

  if (splitPaneTabIds.length > 0) {
    if (activePaneIndex >= splitPaneTabIds.length) {
      setActivePaneIndex(0);
    }
    setActiveTabId(splitPaneTabIds[activePaneIndex]);
    buildSplitDom();
    fitAllSplitTerminals();
  }
}

/**
 * @param {Element} container
 */
export function clearSplitDom(container) {
  const rows = container.querySelectorAll(".split-row");
  rows.forEach((row) => {
    const panes = row.querySelectorAll(".split-pane");
    panes.forEach((pane) => {
      while (pane.firstChild) container.appendChild(pane.firstChild);
      pane.remove();
    });
    row.remove();
  });
  const directPanes = container.querySelectorAll(":scope > .split-pane");
  directPanes.forEach((pane) => {
    while (pane.firstChild) container.appendChild(pane.firstChild);
    pane.remove();
  });
}

export function blurAllTerminals() {
  for (const t of openTabs) {
    if (t.type === "terminal" && t.term) {
      t.term.blur();
      t.term.clearSelection();
    }
  }
}

export function buildSplitDom() {
  blurAllTerminals();
  const container = $("output-container");
  container.classList.add("split-active");

  if (panelBottom) {
    container.classList.add("split-mobile");
    for (let i = 0; i < splitPaneTabIds.length; i++) {
      container.appendChild(createSplitPane(i));
    }
  } else if (splitLayout === "horizontal") {
    container.classList.add("split-horizontal");
    for (let i = 0; i < splitPaneTabIds.length; i++) {
      container.appendChild(createSplitPane(i));
    }
  } else if (splitLayout === "vertical") {
    container.classList.add("split-vertical");
    for (let i = 0; i < splitPaneTabIds.length; i++) {
      container.appendChild(createSplitPane(i));
    }
  } else {
    const rows = calcGridLayout(splitPaneTabIds.length);
    let paneIdx = 0;
    for (const rowCount of rows) {
      const row = document.createElement("div");
      row.className = "split-row";
      for (let j = 0; j < rowCount; j++) {
        row.appendChild(createSplitPane(paneIdx));
        paneIdx++;
      }
      container.appendChild(row);
    }
  }

  updateActivePaneVisual();
}

/**
 * @param {number} index
 * @returns {HTMLElement}
 */
export function createSplitPane(index) {
  const pane = document.createElement("div");
  pane.className = `split-pane pane-${index}`;
  if (index === activePaneIndex) pane.classList.add("active-pane");

  const tabId = splitPaneTabIds[index];
  const frame = $(`frame-${tabId}`);
  const tab = openTabs.find((t) => t.id === tabId);
  if (frame && tab) {
    pane.appendChild(frame);
    frame.style.display = tab.type === "terminal" ? "block" : "";
    ensureTerminalOpened(tab, frame);
  }

  let paneTouchStartY = null;
  pane.addEventListener("touchstart", (e) => {
    paneTouchStartY = e.touches[0].clientY;
  }, { passive: true });
  pane.addEventListener("touchend", (e) => {
    if (e.target.closest(".tab-name-pill")) return;
    const frame = pane.querySelector(".terminal-frame");
    if (frame && frame.classList.contains("view-mode")) return;
    const endY = e.changedTouches[0].clientY;
    if (paneTouchStartY !== null && Math.abs(endY - paneTouchStartY) > 10) return;
    if (activePaneIndex === index && isPaneSelectedByTap) {
      showKeyboardInput();
      return;
    }
    if (activePaneIndex !== index) selectActivePane(index);
    setIsPaneSelectedByTap(true);
  });
  pane.addEventListener("pointerdown", (e) => {
    if (isTouchDevice) return;
    if (e.target.closest(".tab-name-pill")) return;
    const frame = pane.querySelector(".terminal-frame");
    if (frame && frame.classList.contains("view-mode")) return;
    if (activePaneIndex === index) return;
    e.stopPropagation();
    e.preventDefault();
    selectActivePane(index);
  }, true);

  return pane;
}

/**
 * @param {number} index
 */
export function selectActivePane(index) {
  for (const tabId of splitPaneTabIds) {
    if (tabId !== splitPaneTabIds[index]) exitTerminalViewMode(tabId);
  }
  setActivePaneIndex(index);
  setActiveTabId(splitPaneTabIds[index]);
  updateActivePaneVisual();
}

export function updateActivePaneVisual() {
  const container = $("output-container");
  const panes = container.querySelectorAll(".split-pane");
  const singlePane = panes.length <= 1;
  panes.forEach((pane, i) => {
    pane.classList.toggle("active-pane", i === activePaneIndex);
    pane.classList.toggle("split-single", singlePane);
  });
}

/**
 * @param {string} dragTabId
 */
export function showSplitDropZones(dragTabId) {
  hideSplitDropZones();
  const container = $("output-container");
  const overlay = document.createElement("div");
  overlay.className = "split-drop-overlay";

  const allZones = [
    { dir: "left", icon: "mdi-arrow-left" },
    { dir: "right", icon: "mdi-arrow-right" },
    { dir: "top", icon: "mdi-arrow-up" },
    { dir: "bottom", icon: "mdi-arrow-down" },
    { dir: "center", icon: "mdi-fullscreen" },
  ];
  const zones = panelBottom
    ? allZones.filter((z) => z.dir === "top" || z.dir === "bottom" || z.dir === "center")
    : allZones;

  for (const { dir, icon } of zones) {
    const zone = document.createElement("div");
    zone.className = `split-drop-zone drop-${dir}`;
    zone.innerHTML = `<span class="mdi ${icon} drop-zone-icon"></span>`;
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    zone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => {
      zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      hideSplitDropZones();
      splitWithDrop(dragTabId, dir);
    });
    overlay.appendChild(zone);
  }

  container.appendChild(overlay);

  if (!splitMode) {
    const headerTargets = [$("tab-bar")?.parentNode, $("header-row2")].filter(Boolean);
    const closeZone = document.createElement("div");
    closeZone.className = "pill-close-drop-zone";
    closeZone.innerHTML = '<span class="mdi mdi-close drop-zone-icon"></span>';
    let top = Infinity, bottom = 0;
    for (const el of headerTargets) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) {
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
      }
    }
    if (top < bottom) {
      closeZone.style.top = top + "px";
      closeZone.style.height = (bottom - top) + "px";
    }
    closeZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    closeZone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      closeZone.classList.add("drag-over");
    });
    closeZone.addEventListener("dragleave", () => {
      closeZone.classList.remove("drag-over");
    });
    closeZone.addEventListener("drop", (e) => {
      e.preventDefault();
      hideSplitDropZones();
      removeTab(dragTabId);
    });
    document.body.appendChild(closeZone);
  }
}

export function hideSplitDropZones() {
  const existing = document.querySelector(".split-drop-overlay");
  if (existing) existing.remove();
  const closeZone = document.querySelector(".pill-close-drop-zone");
  if (closeZone) closeZone.remove();
}

/**
 * @param {string} dragTabId
 * @param {string} direction
 */
export function splitWithDrop(dragTabId, direction) {
  const dragTab = openTabs.find((t) => t.id === dragTabId);
  if (!dragTab) return;

  if (direction === "center") {
    if (splitMode) exitSplitModeWithTab(dragTabId);
    else switchTab(dragTabId);
    return;
  }

  const newLayout = (direction === "left" || direction === "right") ? "horizontal" : "vertical";

  if (splitMode) {
    const wantFirst = direction === "left" || direction === "top";
    const currentIdx = splitPaneTabIds.indexOf(dragTabId);
    const alreadyFirst = currentIdx === 0;
    const alreadyLast = currentIdx === splitPaneTabIds.length - 1;
    if ((wantFirst && alreadyFirst) || (!wantFirst && alreadyLast)) {
      return;
    }
    const others = splitPaneTabIds.filter((id) => id !== dragTabId);
    setSplitLayout(newLayout);
    setSplitPaneTabIds(wantFirst ? [dragTabId, ...others] : [...others, dragTabId]);
    setActivePaneIndex(splitPaneTabIds.indexOf(dragTabId));
    setActiveTabId(dragTabId);
    rebuildSplitLayout();
    return;
  }

  const currentActiveId = activeTabId;
  const otherId = currentActiveId && currentActiveId !== dragTabId
    ? currentActiveId
    : openTabs.find((t) => t.id !== dragTabId)?.id;
  if (!otherId) return;

  setSplitLayout(newLayout);
  setSplitPaneTabIds((direction === "left" || direction === "top")
    ? [dragTabId, otherId]
    : [otherId, dragTabId]);
  setActivePaneIndex(splitPaneTabIds.indexOf(dragTabId));
  setActiveTabId(dragTabId);

  enterSplitMode();
}

export function fitAllSplitTerminals() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const tabId of splitPaneTabIds) {
        const tab = openTabs.find((t) => t.id === tabId);
        if (tab && tab.type === "terminal") {
          tab.term.clearSelection();
          fitAndSync(tab);
        }
      }
    });
  });
}
