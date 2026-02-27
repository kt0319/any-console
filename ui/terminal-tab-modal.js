function openTabEditModal(initialTab = "layout") {
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

  function showMainView() {
    contentContainer.innerHTML = "";
    setTitle("ワークスペース");
    renderOpenTab();
  }

  function switchModalTab(key) {
    contentContainer.innerHTML = "";
    if (key === "open") {
      showMainView();
    } else {
      renderSubPane(key);
    }
  }

  function renderSubPane(key) {
    const labels = { "ws-add": "WS追加", "layout": "タブ", "settings": "設定" };
    setTitle(labels[key], () => showMainView());
    if (key === "ws-add") showPickerCloneInContainer(contentContainer, "visibility");
    else if (key === "layout") renderLayoutTab(contentContainer);
    else if (key === "settings") renderSettingsTab(contentContainer);
  }

  const modeBtns = [];

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
          splitLayout = m.value;
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

  function updateModeRadio() {
    const current = splitMode ? splitLayout : "normal";
    for (const b of modeBtns) {
      b.className = "split-tab-mode-option" + (b.dataset.mode === current ? " active" : "");
    }
  }

  let dragState = null;

  function switchToSplitModeWithTab(tabId) {
    if (splitMode) return;
    const targetTab = openTabs.find((t) => t.id === tabId);
    if (!targetTab) return;
    const currentActive = openTabs.find((t) => t.id === activeTabId);
    const baseTabId = currentActive ? currentActive.id : openTabs[0]?.id;
    if (!baseTabId) return;

    if (splitLayout === "grid") splitLayout = "vertical";
    enterSplitMode();
    if (!splitPaneTabIds.includes(tabId)) splitPaneTabIds.push(tabId);
    activePaneIndex = Math.max(0, splitPaneTabIds.indexOf(tabId));
    activeTabId = splitPaneTabIds[activePaneIndex] || baseTabId;
    rebuildSplitLayout();
    updateModeRadio();
    renderTabList();
  }

  function toggleRow(tab) {
    if (splitMode) {
      const included = splitPaneTabIds.includes(tab.id);
      if (included) {
        splitPaneTabIds = splitPaneTabIds.filter((id) => id !== tab.id);
        const frame = $(`frame-${tab.id}`);
        if (frame) frame.style.display = "none";
        if (splitLayout === "grid" && splitPaneTabIds.length < 3) {
          splitLayout = "vertical";
        }
      } else {
        splitPaneTabIds.push(tab.id);
      }
      if (splitPaneTabIds.length >= 1) {
        if (activePaneIndex >= splitPaneTabIds.length) activePaneIndex = 0;
        activeTabId = splitPaneTabIds[activePaneIndex];
        const container = $("output-container");
        clearSplitDom(container);
        container.classList.remove("split-active", "split-mobile", "split-vertical", "split-horizontal");
        buildSplitDom();
        fitAllSplitTerminals();
        updateEmptyPlaceholder(false);
      } else {
        updateEmptyPlaceholder(true);
      }
      updateModeRadio();
      renderTabList();
    } else {
      switchTab(tab.id);
      renderTabList();
    }
  }

  function openOrphanRow(orphan, preferSplit = false) {
    const baseTabId = activeTabId;
    if (orphan.expired) {
      disconnectedSessions = disconnectedSessions.filter((o) => o.wsUrl !== orphan.wsUrl);
      closedSessionUrls.add(orphan.wsUrl);
      runJob(orphan.jobName || "terminal", null, orphan.workspace);
      return null;
    }

    joinOrphanSession(orphan.wsUrl, orphan.workspace);
    const joinedTab = openTabs.find((t) => t.wsUrl === orphan.wsUrl);

    if (preferSplit && !splitMode) {
      const hasBaseTab = !!baseTabId && openTabs.some((t) => t.id === baseTabId);
      if (joinedTab && hasBaseTab && joinedTab.id !== baseTabId) {
        if (splitLayout === "grid") splitLayout = "vertical";
        enterSplitMode();
        if (!splitPaneTabIds.includes(baseTabId)) splitPaneTabIds.unshift(baseTabId);
        activePaneIndex = Math.max(0, splitPaneTabIds.indexOf(joinedTab.id));
        activeTabId = splitPaneTabIds[activePaneIndex] || joinedTab.id;
        rebuildSplitLayout();
      }
    }
    return joinedTab ? joinedTab.id : null;
  }

  function renderTabList() {
    const list = contentContainer.querySelector(".split-tab-list");
    if (!list) return;
    list.innerHTML = "";
    for (let i = 0; i < openTabs.length; i++) {
      const tab = openTabs[i];

      const row = document.createElement("div");
      row.className = "split-tab-row";
      row.dataset.idx = i;
      if (!splitMode && tab.id === activeTabId) row.classList.add("active");

      const inputWrap = document.createElement("span");
      inputWrap.className = "split-tab-input-wrap";
      const isActiveTab = tab.id === activeTabId;
      const isIncluded = splitPaneTabIds.includes(tab.id);

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.className = "split-tab-input";
      radio.checked = isActiveTab;
      radio.disabled = splitMode ? !isIncluded : false;
      radio.addEventListener("click", (e) => {
        e.stopPropagation();
        if (splitMode) {
          const idx = splitPaneTabIds.indexOf(tab.id);
          if (idx >= 0) {
            setActivePaneIndex(idx);
            renderTabList();
          }
          return;
        }
        switchTab(tab.id);
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
      row.appendChild(inputWrap);

      const handle = document.createElement("span");
      handle.className = "split-tab-drag-handle";
      handle.innerHTML = '<span class="mdi mdi-drag"></span>';
      bindDragHandle(handle, row, i, list);
      row.appendChild(handle);

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
            setActivePaneIndex(idx);
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

    for (const s of disconnectedSessions) {
      const row = document.createElement("div");
      row.className = "split-tab-row split-tab-row-orphan" + (s.expired ? " split-tab-row-expired" : "");

      const inputWrap = document.createElement("span");
      inputWrap.className = "split-tab-input-wrap";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.className = "split-tab-input";
      radio.checked = false;
      radio.addEventListener("click", (e) => {
        e.stopPropagation();
        openOrphanRow(s, false);
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
        openOrphanRow(s, !splitMode);
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
        const joinedTabId = openOrphanRow(s, false);
        if (joinedTabId && splitMode) {
          exitSplitModeWithTab(joinedTabId);
        }
        renderTabList();
        updateModeRadio();
      });
      row.appendChild(info);

      row.addEventListener("click", (e) => {
        if (e.target.closest(".split-tab-close-btn")) return;
        if (e.target.closest(".split-tab-input")) return;
        openOrphanRow(s, false);
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
        if (!s.expired) {
          const match = s.wsUrl.match(/\/terminal\/ws\/([^/]+)/);
          if (match) {
            deleteTerminalSession(match[1]);
          }
        }
        disconnectedSessions = disconnectedSessions.filter((o) => o.wsUrl !== s.wsUrl);
        closedSessionUrls.add(s.wsUrl);
        renderTabList();
      });
      row.appendChild(closeBtnEl);

      list.appendChild(row);
    }
  }

  function bindDragHandle(handle, row, idx, list) {
    function onStart(e) {
      e.preventDefault();
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      const rowRect = row.getBoundingClientRect();
      dragState = { idx, startY: y, offsetY: y - rowRect.top, rowHeight: rowRect.height };
      row.classList.add("dragging");
      row.style.position = "relative";
      row.style.zIndex = "10";

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

  function applyTabOrder(list) {
    const rows = Array.from(list.children);
    const newOrder = rows.map((r) => openTabs[parseInt(r.dataset.idx)]).filter(Boolean);

    openTabs.length = 0;
    openTabs.push(...newOrder);

    if (splitMode) {
      splitPaneTabIds = newOrder.map((t) => t.id);
      activePaneIndex = splitPaneTabIds.indexOf(activeTabId);
      rebuildSplitLayout();
    } else {
      renderTabBar();
    }
  }

  function renderOpenTab() {
    workspaceSection.renderOpenTab();
  }

  function renderModalWsList(container) {
    workspaceSection.renderModalWsList(container);
  }

  function renderSettingsTab(target) {
    const container = target || contentContainer;
    renderSettingsMenu(container);
  }

  function renderSettingsMenu(target) {
    const container = target || contentContainer;
    container.innerHTML = "";
    const menu = document.createElement("div");
    menu.className = "settings-menu";

    const items = [
      { icon: "mdi-download", label: "設定エクスポート", action: () => exportSettings() },
      { icon: "mdi-upload", label: "設定インポート", action: () => importSettings() },
      { icon: "mdi-format-list-bulleted", label: "プロセス一覧", action: () => showModalSubView("プロセス一覧", renderProcessListTo) },
      { icon: "mdi-information-outline", label: "サーバー情報", action: () => showModalSubView("サーバー情報", renderServerInfoTo) },
      { icon: "mdi-text-box-outline", label: "操作ログ", action: () => showModalSubView("操作ログ", renderOpLogTo) },
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

  function showModalSubView(subTitle, renderFn) {
    contentContainer.innerHTML = "";
    setTitle(subTitle, () => switchModalTab("settings"));
    const body = document.createElement("div");
    body.className = "split-tab-settings-body";
    contentContainer.appendChild(body);
    renderFn(body);
  }

  function showPickerCloneInContainer(content, defaultTab = "github") {
    workspaceSection.showPickerCloneInContainer(content, defaultTab);
  }

  function closeModal() {
    overlay.remove();
  }

  if (initialTab === "open") showMainView();
  else switchModalTab(initialTab);
}
