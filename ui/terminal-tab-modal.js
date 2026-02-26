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
  modal.appendChild(contentContainer);

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
      if (splitMode) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "split-tab-input";
        checkbox.checked = splitPaneTabIds.includes(tab.id);
        checkbox.disabled = true;
        inputWrap.appendChild(checkbox);
      } else {
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.className = "split-tab-input";
        radio.checked = tab.id === activeTabId;
        radio.disabled = true;
        inputWrap.appendChild(radio);
      }
      row.appendChild(inputWrap);

      const handle = document.createElement("span");
      handle.className = "split-tab-drag-handle";
      handle.innerHTML = '<span class="mdi mdi-drag"></span>';
      bindDragHandle(handle, row, i, list);
      row.appendChild(handle);

      const info = document.createElement("span");
      info.className = "split-tab-row-info";
      info.innerHTML = renderTabIconHtml(tab) + escapeHtml(tabDisplayName(tab) || tab.label || "");
      row.appendChild(info);

      row.addEventListener("click", (e) => {
        if (e.target.closest(".split-tab-drag-handle")) return;
        if (e.target.closest(".split-tab-close-btn")) return;
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
      row.appendChild(info);

      row.addEventListener("click", (e) => {
        if (e.target.closest(".split-tab-close-btn")) return;
        if (s.expired) {
          disconnectedSessions = disconnectedSessions.filter((o) => o.wsUrl !== s.wsUrl);
          closedSessionUrls.add(s.wsUrl);
          runJob(s.jobName || "terminal", null, s.workspace);
          return;
        }
        joinOrphanSession(s.wsUrl, s.workspace);
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
    const actionRow = document.createElement("div");
    actionRow.className = "picker-ws-add-section";
    const subItems = [
      { key: "layout", icon: "mdi-tab", label: "タブ" },
      { key: "settings", icon: "mdi-cog", label: "設定" },
    ];
    for (const item of subItems) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ws-add-action-btn";
      btn.innerHTML = `<span class="mdi ${item.icon}"></span> ${item.label}`;
      btn.addEventListener("click", () => switchModalTab(item.key));
      actionRow.appendChild(btn);
    }
    contentContainer.appendChild(actionRow);

    const list = document.createElement("div");
    list.className = "terminal-ws-list";
    renderModalWsList(list);
    contentContainer.appendChild(list);
  }

  function renderModalWsList(container) {
    const workspaces = visibleWorkspaces();
    for (const ws of workspaces) {
      const group = document.createElement("div");
      group.className = "picker-ws-group";

      const headerEl = document.createElement("div");
      headerEl.className = "picker-ws-header";

      const headerLabel = document.createElement("button");
      headerLabel.type = "button";
      headerLabel.className = "picker-ws-header-label";
      headerLabel.innerHTML = renderIcon(ws.icon || "mdi-console", ws.icon_color, 18) + escapeHtml(ws.name);
      headerLabel.addEventListener("click", () => {
        runJob("terminal", null, ws.name);
      });
      headerEl.appendChild(headerLabel);

      const icons = document.createElement("div");
      icons.className = "picker-ws-icons";
      headerEl.appendChild(icons);

      const gearBtn = document.createElement("button");
      gearBtn.type = "button";
      gearBtn.className = "picker-ws-icon-btn ws-gear-btn";
      gearBtn.innerHTML = '<span class="mdi mdi-cog"></span>';
      gearBtn.addEventListener("click", () => {
        contentContainer.innerHTML = "";
        setTitle(ws.name, () => showMainView());
        renderWorkspaceSettingsPane(contentContainer, ws, () => showMainView(), setTitle);
      });
      headerEl.appendChild(gearBtn);

      group.appendChild(headerEl);
      container.appendChild(group);

      loadWorkspaceIconButtons(icons, ws, 18,
        (link) => { window.open(link.url, "_blank"); },
        (name, job) => {
          if (job.confirm !== false) {
            if (!confirm(`${job.label || name} を実行しますか？`)) return;
          }
          closeModal();
          runJob(name, null, ws.name);
        },
      );
    }

    const addItem = document.createElement("div");
    addItem.className = "picker-ws-group";
    const addHeader = document.createElement("div");
    addHeader.className = "picker-ws-header";
    const addLabel = document.createElement("button");
    addLabel.type = "button";
    addLabel.className = "picker-ws-header-label picker-ws-add-label";
    addLabel.innerHTML = '<span class="mdi mdi-plus"></span> WS追加';
    addLabel.addEventListener("click", () => switchModalTab("ws-add"));
    addHeader.appendChild(addLabel);
    addItem.appendChild(addHeader);
    container.appendChild(addItem);
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
    let pickerCloneTab = defaultTab;
    let pickerSelectedUrl = "";
    let pickerRepos = [];

    const cloneModalActiveTabs = document.createElement("div");
    cloneModalActiveTabs.className = "clone-openTabs";
    const githubBtn = document.createElement("button");
    githubBtn.type = "button";
    githubBtn.className = "clone-tab" + (defaultTab === "github" ? " active" : "");
    githubBtn.textContent = "GitHub";
    const urlBtn = document.createElement("button");
    urlBtn.type = "button";
    urlBtn.className = "clone-tab" + (defaultTab === "url" ? " active" : "");
    urlBtn.textContent = "手動入力";
    const visibilityBtn = document.createElement("button");
    visibilityBtn.type = "button";
    visibilityBtn.className = "clone-tab" + (defaultTab === "visibility" ? " active" : "");
    visibilityBtn.textContent = "表示設定";
    cloneModalActiveTabs.append(visibilityBtn, githubBtn, urlBtn);
    content.appendChild(cloneModalActiveTabs);

    const githubPane = document.createElement("div");
    githubPane.className = "clone-tab-content";
    githubPane.style.display = defaultTab === "github" ? "block" : "none";
    const repoList = document.createElement("div");
    repoList.className = "clone-repo-list";
    repoList.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
    githubPane.appendChild(repoList);
    content.appendChild(githubPane);

    const urlPane = document.createElement("div");
    urlPane.className = "clone-tab-content";
    urlPane.style.display = defaultTab === "url" ? "block" : "none";
    const urlGroup = document.createElement("div");
    urlGroup.className = "form-group";
    urlGroup.innerHTML = '<label class="form-label">リポジトリ</label>';
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "form-input";
    urlInput.placeholder = "git@github.com:user/repo.git or https://...";
    urlInput.autocomplete = "off";
    urlGroup.appendChild(urlInput);
    urlPane.appendChild(urlGroup);
    content.appendChild(urlPane);

    const visibilityPane = document.createElement("div");
    visibilityPane.className = "clone-tab-content";
    visibilityPane.style.display = defaultTab === "visibility" ? "block" : "none";
    if (defaultTab === "visibility") renderWorkspaceVisibilityChecklistTo(visibilityPane);
    content.appendChild(visibilityPane);

    const nameGroup = document.createElement("div");
    nameGroup.className = "form-group";
    nameGroup.innerHTML = '<label class="form-label">ディレクトリ名 <span class="form-hint">(省略時はリポジトリ名)</span></label>';
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-input";
    nameInput.autocomplete = "off";
    nameGroup.appendChild(nameInput);
    const cloneFields = document.createElement("div");
    if (defaultTab === "visibility") cloneFields.style.display = "none";
    cloneFields.appendChild(nameGroup);

    const errorEl = document.createElement("div");
    errorEl.className = "form-error";
    cloneFields.appendChild(errorEl);

    const outputEl = document.createElement("div");
    outputEl.className = "clone-output";
    outputEl.style.display = "none";
    cloneFields.appendChild(outputEl);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "primary";
    submitBtn.style.width = "auto";
    submitBtn.textContent = "クローン";
    actions.appendChild(submitBtn);
    cloneFields.appendChild(actions);
    content.appendChild(cloneFields);

    function switchCloneTabInner(tab) {
      pickerCloneTab = tab;
      githubBtn.classList.toggle("active", tab === "github");
      urlBtn.classList.toggle("active", tab === "url");
      visibilityBtn.classList.toggle("active", tab === "visibility");
      githubPane.style.display = tab === "github" ? "block" : "none";
      urlPane.style.display = tab === "url" ? "block" : "none";
      visibilityPane.style.display = tab === "visibility" ? "block" : "none";
      cloneFields.style.display = tab === "visibility" ? "none" : "";
      if (tab === "url") urlInput.focus();
      if (tab === "visibility") renderWorkspaceVisibilityChecklistTo(visibilityPane);
      if (tab === "github" && pickerRepos.length === 0) loadRepos();
    }

    githubBtn.addEventListener("click", () => switchCloneTabInner("github"));
    urlBtn.addEventListener("click", () => switchCloneTabInner("url"));
    visibilityBtn.addEventListener("click", () => switchCloneTabInner("visibility"));

    function renderRepos() {
      if (pickerRepos.length === 0) {
        repoList.innerHTML = '<div class="clone-repo-empty">リポジトリがありません</div>';
        return;
      }
      repoList.innerHTML = "";
      for (const repo of pickerRepos) {
        const item = document.createElement("div");
        item.className = "clone-repo-item" + (pickerSelectedUrl === repo.url ? " selected" : "");
        item.innerHTML = `<div class="clone-repo-name">${escapeHtml(repo.nameWithOwner)}</div>` +
          (repo.description ? `<div class="clone-repo-desc">${escapeHtml(repo.description)}</div>` : "");
        item.addEventListener("click", () => {
          pickerSelectedUrl = repo.url;
          renderRepos();
        });
        repoList.appendChild(item);
      }
    }

    async function loadRepos() {
      repoList.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
      try {
        pickerRepos = await fetchGithubRepos();
        renderRepos();
      } catch (e) {
        repoList.innerHTML = `<div class="clone-repo-error">${escapeHtml(e.message)}</div>`;
      }
    }

    submitBtn.addEventListener("click", async () => {
      let url = pickerCloneTab === "github" ? pickerSelectedUrl : urlInput.value.trim();
      url = toSshUrl(url);
      const name = nameInput.value.trim();

      if (!url) {
        errorEl.textContent = pickerCloneTab === "github" ? "リポジトリを選択してください" : "URLを入力してください";
        errorEl.style.display = "block";
        return;
      }

      errorEl.style.display = "none";
      outputEl.style.display = "block";
      outputEl.textContent = "cloning...";
      submitBtn.disabled = true;

      try {
        const res = await apiFetch("/workspaces", {
          method: "POST",
          body: { url, name: name || null },
        });
        if (!res) return;
        const data = await res.json();
        if (!res.ok || data.status === "error") {
          errorEl.textContent = data.detail || data.stderr || "クローンに失敗しました";
          errorEl.style.display = "block";
          outputEl.style.display = "none";
          submitBtn.disabled = false;
          return;
        }
        outputEl.textContent = `${data.name} をクローンしました`;
        invalidateWorkspaceMetaCache();
        await loadWorkspaces();
        switchModalTab("open");
      } catch (e) {
        errorEl.textContent = e.message;
        errorEl.style.display = "block";
        outputEl.style.display = "none";
        submitBtn.disabled = false;
      }
    });

    if (defaultTab === "github") loadRepos();
  }

  function closeModal() {
    overlay.remove();
  }

  if (initialTab === "open") showMainView();
  else switchModalTab(initialTab);
}
