function createTerminalTabModalWorkspaceSection(deps) {
  const {
    contentContainer,
    switchModalTab,
    closeModal,
    setTitle,
    showMainView,
  } = deps;

  function renderOpenTab() {
    const actionRow = document.createElement("div");
    actionRow.className = "picker-ws-add-section";
    const subItems = [
      { key: "layout", icon: "mdi-tab", label: "タブ" },
      { key: "ws-visibility", icon: "mdi-eye", label: "表示" },
      { key: "ws-add", icon: "mdi-plus", label: "追加" },
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
    async function executeWsRemoteOp(wsName, endpoint, label, button) {
      const ws = allWorkspaces.find((w) => w.name === wsName);
      const branch = ws && ws.branch ? ws.branch : "(不明)";
      const actionLabel = label === "追跡設定" ? "追跡設定" : label;
      const msg = `${actionLabel} を実行しますか？\nリポジトリ: ${wsName}\nブランチ: ${branch}`;
      if (!confirm(msg)) return;
      if (button) {
        button.disabled = true;
        button.classList.add("running");
      }
      try {
        await postWorkspaceAction(wsName, endpoint, label);
      } finally {
        if (button) {
          button.classList.remove("running");
          button.disabled = false;
        }
        await loadWorkspaces();
        if (selectedWorkspace === wsName) {
          await refreshWorkspaceHeader();
        }
        container.innerHTML = "";
        renderModalWsList(container);
      }
    }

    const workspaces = visibleWorkspaces();
    for (const ws of workspaces) {
      const group = document.createElement("div");
      group.className = "picker-ws-group";

      const topRow = document.createElement("div");
      topRow.className = "picker-ws-row picker-ws-row-top";

      const headerLabel = document.createElement("button");
      headerLabel.type = "button";
      headerLabel.className = "picker-ws-header-label";
      headerLabel.innerHTML =
        renderIcon(ws.icon || "mdi-console", ws.icon_color, 18) +
        `<span class="picker-ws-header-text"><span class="picker-ws-name">${escapeHtml(ws.name)}</span><span class="picker-ws-branch">${escapeHtml(ws.branch || "-")}</span></span>`;
      headerLabel.addEventListener("click", () => {
        closeModal();
        runJob("terminal", null, ws.name);
      });
      topRow.appendChild(headerLabel);

      const topMeta = document.createElement("div");
      topMeta.className = "picker-ws-top-meta";

      const dirtyHtml = buildWorkspaceChangeSummaryHtml(ws);
      if (dirtyHtml) {
        const dirtyBadge = document.createElement("span");
        dirtyBadge.className = "git-badge dirty";
        dirtyBadge.innerHTML = dirtyHtml;
        topMeta.appendChild(dirtyBadge);
      }

      const hasUpstream = ws.has_upstream !== false;
      const hasRemoteBranch = ws.has_remote_branch === true;
      if (!hasUpstream) {
        const upstreamBtn = document.createElement("button");
        upstreamBtn.type = "button";
        if (hasRemoteBranch) {
          upstreamBtn.className = "picker-ws-mini-btn upstream-set-btn";
          upstreamBtn.innerHTML = `<span class="mdi mdi-link-variant"></span><span>追跡</span>`;
          upstreamBtn.addEventListener("click", () => executeWsRemoteOp(ws.name, "/set-upstream", "追跡設定", upstreamBtn));
        } else {
          const hasAhead = ws.ahead > 0;
          const aheadCount = String(ws.ahead ?? 0);
          upstreamBtn.className = "picker-ws-mini-btn upstream-btn" + (hasAhead ? " has-count" : "");
          upstreamBtn.innerHTML = `<span class="mdi mdi-chevron-double-up"></span><span>${aheadCount}</span>`;
          upstreamBtn.addEventListener("click", () => executeWsRemoteOp(ws.name, "/push-upstream", "push", upstreamBtn));
        }
        topMeta.appendChild(upstreamBtn);
      }

      if (hasUpstream && ws.ahead > 0) {
        const pushBtn = document.createElement("button");
        pushBtn.type = "button";
        pushBtn.className = "picker-ws-mini-btn push-btn has-count";
        pushBtn.innerHTML = `<span class="mdi mdi-arrow-up"></span><span>${ws.ahead}</span>`;
        pushBtn.addEventListener("click", () => executeWsRemoteOp(ws.name, "/push", "push", pushBtn));
        topMeta.appendChild(pushBtn);
      }

      if (ws.behind > 0) {
        const pullBtn = document.createElement("button");
        pullBtn.type = "button";
        pullBtn.className = "picker-ws-mini-btn pull-btn has-count";
        pullBtn.innerHTML = `<span class="mdi mdi-arrow-down"></span><span>${ws.behind}</span>`;
        pullBtn.addEventListener("click", () => executeWsRemoteOp(ws.name, "/pull", "pull", pullBtn));
        topMeta.appendChild(pullBtn);
      }

      topRow.appendChild(topMeta);
      group.appendChild(topRow);

      const bottomRow = document.createElement("div");
      bottomRow.className = "picker-ws-row picker-ws-row-bottom";

      const icons = document.createElement("div");
      icons.className = "picker-ws-icons picker-ws-icons-bottom";
      bottomRow.appendChild(icons);

      const gearBtn = document.createElement("button");
      gearBtn.type = "button";
      gearBtn.className = "picker-ws-icon-btn ws-gear-btn";
      gearBtn.innerHTML = '<span class="mdi mdi-cog"></span>';
      gearBtn.addEventListener("click", () => {
        contentContainer.innerHTML = "";
        setTitle(ws.name, () => showMainView());
        renderWorkspaceSettingsPane(contentContainer, ws, () => showMainView(), setTitle);
      });
      bottomRow.appendChild(gearBtn);

      group.appendChild(bottomRow);
      container.appendChild(group);

      loadWorkspaceIconButtons(icons, ws, 18,
        (link) => { closeModal(); window.open(link.url, "_blank"); },
        (name, job) => {
          if (job.confirm !== false) {
            if (!confirm(`${job.label || name} を実行しますか？`)) return;
          }
          closeModal();
          runJob(name, null, ws.name);
        },
      )
        .then((count) => {
          if (count === 0) bottomRow.classList.add("is-empty");
        })
        .catch((e) => {
          console.error("workspace icon buttons load failed:", e);
          bottomRow.classList.add("is-empty");
        });
    }

    // ワークスペース項目の末尾に新規追加ボタンは出さない
  }

  function showPickerCloneInContainer(content, mode = "visibility") {
    let pickerSelectedUrl = "";
    let pickerRepos = [];

    if (mode === "visibility") {
      const visibilityPane = document.createElement("div");
      visibilityPane.className = "clone-tab-content";
      renderWorkspaceVisibilityChecklistTo(visibilityPane);
      content.appendChild(visibilityPane);
      return;
    }

    const addPane = document.createElement("div");
    addPane.className = "clone-tab-content";
    addPane.style.display = "block";

    const sourceGroup = document.createElement("div");
    sourceGroup.className = "form-group";
    sourceGroup.innerHTML = '<label class="form-label">GitHub</label>';
    addPane.appendChild(sourceGroup);

    const repoList = document.createElement("div");
    repoList.className = "clone-repo-list";
    repoList.innerHTML = '<div class="clone-repo-loading">読み込み中...</div>';
    addPane.appendChild(repoList);

    const urlGroup = document.createElement("div");
    urlGroup.className = "form-group";
    urlGroup.innerHTML = '<label class="form-label">リポジトリパス <span class="form-hint">(省略可)</span></label>';
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.className = "form-input";
    urlInput.placeholder = "git@github.com:user/repo.git or https://...";
    urlInput.autocomplete = "off";
    urlGroup.appendChild(urlInput);
    addPane.appendChild(urlGroup);
    content.appendChild(addPane);

    const nameGroup = document.createElement("div");
    nameGroup.className = "form-group";
    nameGroup.innerHTML = '<label class="form-label">ディレクトリ名 <span class="form-hint">(リポジトリ未入力ならこの名前で空ディレクトリを作成)</span></label>';
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-input";
    nameInput.autocomplete = "off";
    nameGroup.appendChild(nameInput);
    const cloneFields = document.createElement("div");
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
    submitBtn.textContent = "作成";
    actions.appendChild(submitBtn);
    cloneFields.appendChild(actions);
    content.appendChild(cloneFields);

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
          urlInput.value = toSshUrl(repo.url);
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
      let url = urlInput.value.trim() || pickerSelectedUrl;
      url = toSshUrl(url);
      const name = nameInput.value.trim();

      if (!url && !name) {
        errorEl.textContent = "リポジトリを選択してください";
        errorEl.style.display = "block";
        return;
      }

      errorEl.style.display = "none";
      outputEl.style.display = "block";
      outputEl.textContent = !url ? "creating directory..." : "cloning...";
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
        outputEl.textContent = data.mode === "directory"
          ? `${data.name} ディレクトリを作成しました`
          : `${data.name} をクローンしました`;
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

    loadRepos();
  }

  return {
    renderOpenTab,
    renderModalWsList,
    showPickerCloneInContainer,
  };
}
