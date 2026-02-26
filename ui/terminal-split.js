function calcGridLayout(count) {
  if (count <= 1) return [count];
  const topRow = Math.ceil(count / 2);
  return [topRow, count - topRow];
}

function enterSplitMode() {
  if (tabs.length < 1) return;
  if (splitMode) return;

  splitMode = true;
  paneSelectedByTap = false;
  exitAllCopyModes();
  if (activeTabId && tabs.some((t) => t.id === activeTabId)) {
    splitPaneTabIds = [activeTabId];
    activePaneIndex = 0;
    buildSplitDom();
    fitAllSplitTerminals();
  } else {
    splitPaneTabIds = [];
    activePaneIndex = 0;
    for (const tab of tabs) {
      const el = $(`frame-${tab.id}`);
      if (el) el.style.display = "none";
    }
  }
  renderTabBar();
  updateGitBarVisibility();
}

function exitSplitMode() {
  exitSplitModeWithTab(activeTabId);
}

function exitSplitModeWithTab(targetTabId) {
  if (!splitMode) return;

  const container = $("output-container");
  clearSplitDom(container);
  container.classList.remove("split-active", "split-mobile", "split-vertical", "split-horizontal");

  splitMode = false;
  splitPaneTabIds = [];
  activePaneIndex = 0;

  const target = tabs.find((t) => t.id === targetTabId) ? targetTabId : activeTabId;
  for (const tab of tabs) {
    const el = $(`frame-${tab.id}`);
    if (el) {
      el.style.display = tab.id === target ? (tab.type === "terminal" ? "block" : "") : "none";
    }
  }

  switchTab(target);
}

function rebuildSplitLayout() {
  if (!splitMode) return;
  blurAllTerminals();
  const container = $("output-container");
  clearSplitDom(container);
  container.classList.remove("split-active", "split-mobile", "split-vertical", "split-horizontal");

  if (tabs.length === 0) {
    exitSplitModeWithTab(null);
    return;
  }

  const tabIds = new Set(tabs.map((t) => t.id));
  splitPaneTabIds = splitPaneTabIds.filter((id) => tabIds.has(id));

  if (splitPaneTabIds.length > 0) {
    if (activePaneIndex >= splitPaneTabIds.length) {
      activePaneIndex = 0;
    }
    activeTabId = splitPaneTabIds[activePaneIndex];
    buildSplitDom();
    fitAllSplitTerminals();
  }
}

function clearSplitDom(container) {
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

function blurAllTerminals() {
  for (const t of tabs) {
    if (t.type === "terminal" && t.term) {
      t.term.blur();
      t.term.clearSelection();
    }
  }
}

function buildSplitDom() {
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

function createSplitPane(index) {
  const pane = document.createElement("div");
  pane.className = `split-pane pane-${index}`;
  if (index === activePaneIndex) pane.classList.add("active-pane");

  const tabId = splitPaneTabIds[index];
  const frame = $(`frame-${tabId}`);
  const tab = tabs.find((t) => t.id === tabId);
  if (frame && tab) {
    pane.appendChild(frame);
    frame.style.display = tab.type === "terminal" ? "block" : "";
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
    if (activePaneIndex === index && paneSelectedByTap) {
      showKeyboardInput();
      return;
    }
    if (activePaneIndex !== index) setActivePaneIndex(index);
    paneSelectedByTap = true;
  });
  pane.addEventListener("pointerdown", (e) => {
    if (isTouchDevice) return;
    if (e.target.closest(".tab-name-pill")) return;
    const frame = pane.querySelector(".terminal-frame");
    if (frame && frame.classList.contains("view-mode")) return;
    if (activePaneIndex === index) return;
    e.stopPropagation();
    e.preventDefault();
    setActivePaneIndex(index);
  }, true);

  return pane;
}

function setActivePaneIndex(index) {
  for (const tabId of splitPaneTabIds) {
    if (tabId !== splitPaneTabIds[index]) exitTerminalCopyMode(tabId);
  }
  activePaneIndex = index;
  activeTabId = splitPaneTabIds[index];
  updateActivePaneVisual();
}

function updateActivePaneVisual() {
  const container = $("output-container");
  container.querySelectorAll(".split-pane").forEach((pane, i) => {
    pane.classList.toggle("active-pane", i === activePaneIndex);
  });
}

function fitAllSplitTerminals() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const tabId of splitPaneTabIds) {
        const tab = tabs.find((t) => t.id === tabId);
        if (tab && tab.type === "terminal") {
          tab.term.clearSelection();
          fitAndSync(tab);
        }
      }
    });
  });
}
