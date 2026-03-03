function createTerminalTabModalWorkspaceSection(deps) {
  const {
    contentContainer,
    switchModalTab,
    closeModal,
    setTitle,
    showMainView,
  } = deps;

  function renderOpenTab() {
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
        await refreshWorkspaceStatusInModal(wsName, container);
        if (selectedWorkspace === wsName) {
          await refreshWorkspaceHeader();
        }
      }
    }

    async function refreshWorkspaceStatusInModal(wsName, listContainer) {
      const res = await apiFetch(workspaceApiPath(wsName, "/status"));
      if (!res || !res.ok) return;
      const status = await res.json();
      const idx = allWorkspaces.findIndex((w) => w.name === wsName);
      if (idx < 0) return;
      allWorkspaces[idx] = { ...allWorkspaces[idx], ...status };
      const group = listContainer.querySelector(`[data-workspace-name="${wsName}"]`);
      if (group) {
        updateModalWsGroupGitInfo(group, allWorkspaces[idx]);
      }
    }

    const workspaces = visibleWorkspaces();
    if (workspaces.length === 0) {
      const empty = document.createElement("div");
      empty.className = "clone-repo-empty";
      empty.textContent = "表示中のワークスペースがありません";
      container.appendChild(empty);

      const hiddenCount = allWorkspaces.filter((ws) => ws.hidden).length;
      if (hiddenCount > 0) {
        const actions = document.createElement("div");
        actions.className = "empty-tab-actions";
        const restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.className = "empty-tab-open-btn empty-tab-restore-btn";
        restoreBtn.innerHTML = `<span class="mdi mdi-eye-refresh"></span> 全て復元 (${hiddenCount})`;
        restoreBtn.addEventListener("click", () => restoreAllHiddenWorkspacesWithButton(restoreBtn, async () => {
          container.innerHTML = "";
          renderModalWsList(container);
          renderTabBar();
        }));
        actions.appendChild(restoreBtn);
        container.appendChild(actions);
      }
      return;
    }

    for (const ws of workspaces) {
      const group = document.createElement("div");
      group.className = "picker-ws-group";
      group.dataset.workspaceName = ws.name;

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

      if (ws.is_git_repo) {
        const detailBtn = document.createElement("button");
        detailBtn.type = "button";
        detailBtn.className = "picker-ws-icon-btn ws-gear-btn";
        detailBtn.innerHTML = '<span class="mdi mdi-history"></span>';
        detailBtn.addEventListener("click", () => {
          closeModal();
          selectedWorkspace = ws.name;
          GitLogModal.openGitLogModal({
            onBack: () => {
              GitLogModal.closeGitLogModal();
              openTabEditModal("workspace");
            },
          });
        });
        bottomRow.appendChild(detailBtn);
      }

      group.appendChild(bottomRow);
      container.appendChild(group);

      const dropHint = document.createElement("div");
      dropHint.className = "picker-ws-drop-hint";
      dropHint.innerHTML = '<span class="mdi mdi-upload"></span> ここにドロップでルートへアップロード';
      group.appendChild(dropHint);

      bindWorkspaceUploadDropTarget(group, {
        workspaceName: ws.name,
        getPath: () => "",
        onSuccess: async () => {
          await refreshWorkspaceStatusInModal(ws.name, container);
          if (selectedWorkspace === ws.name) {
            await refreshWorkspaceHeader();
          }
        },
        activeClass: "picker-ws-group-drop-active",
      });

      loadWorkspaceIconButtons(icons, ws, 18, (name, job) => {
          if (job.confirm !== false) {
            if (!confirm(`${job.label || name} を実行しますか？`)) return;
          }
          closeModal();
          runJob(name, null, ws.name);
        })
        .then((count) => {
          if (count === 0) bottomRow.classList.add("is-empty");
        })
        .catch((e) => {
          console.error("workspace icon buttons load failed:", e);
          bottomRow.classList.add("is-empty");
        });
    }

    fetchModalWsGitStatuses(workspaces, container);
  }

  function fetchModalWsGitStatuses(workspaces, listContainer) {
    const gitWorkspaces = workspaces.filter((ws) => ws.is_git_repo);
    for (const ws of gitWorkspaces) {
      apiFetch(workspaceApiPath(ws.name, "/status"))
        .then(async (res) => {
          if (!res || !res.ok) return;
          const status = await res.json();
          const idx = allWorkspaces.findIndex((w) => w.name === ws.name);
          if (idx < 0) return;
          allWorkspaces[idx] = { ...allWorkspaces[idx], ...status };
          const group = listContainer.querySelector(`[data-workspace-name="${ws.name}"]`);
          if (group) {
            updateModalWsGroupGitInfo(group, allWorkspaces[idx]);
          }
        })
        .catch(() => {});
    }
  }

  function updateModalWsGroupGitInfo(group, ws) {
    const topMeta = group.querySelector(".picker-ws-top-meta");
    if (!topMeta) return;
    topMeta.innerHTML = "";

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
        upstreamBtn.addEventListener("click", () => {
          const container = group.closest(".terminal-ws-list");
          if (container) executeWsRemoteOpFromGroup(ws.name, "/set-upstream", "追跡設定", upstreamBtn, container);
        });
      } else {
        const hasAhead = ws.ahead > 0;
        const aheadCount = String(ws.ahead ?? 0);
        upstreamBtn.className = "picker-ws-mini-btn upstream-btn" + (hasAhead ? " has-count" : "");
        upstreamBtn.innerHTML = `<span class="mdi mdi-chevron-double-up"></span><span>${aheadCount}</span>`;
        upstreamBtn.addEventListener("click", () => {
          const container = group.closest(".terminal-ws-list");
          if (container) executeWsRemoteOpFromGroup(ws.name, "/push-upstream", "push", upstreamBtn, container);
        });
      }
      topMeta.appendChild(upstreamBtn);
    }

    if (hasUpstream && ws.ahead > 0) {
      const pushBtn = document.createElement("button");
      pushBtn.type = "button";
      pushBtn.className = "picker-ws-mini-btn push-btn has-count";
      pushBtn.innerHTML = `<span class="mdi mdi-arrow-up"></span><span>${ws.ahead}</span>`;
      pushBtn.addEventListener("click", () => {
        const container = group.closest(".terminal-ws-list");
        if (container) executeWsRemoteOpFromGroup(ws.name, "/push", "push", pushBtn, container);
      });
      topMeta.appendChild(pushBtn);
    }

    if (ws.behind > 0) {
      const pullBtn = document.createElement("button");
      pullBtn.type = "button";
      pullBtn.className = "picker-ws-mini-btn pull-btn has-count";
      pullBtn.innerHTML = `<span class="mdi mdi-arrow-down"></span><span>${ws.behind}</span>`;
      pullBtn.addEventListener("click", () => {
        const container = group.closest(".terminal-ws-list");
        if (container) executeWsRemoteOpFromGroup(ws.name, "/pull", "pull", pullBtn, container);
      });
      topMeta.appendChild(pullBtn);
    }

    const branchEl = group.querySelector(".picker-ws-branch");
    if (branchEl) {
      branchEl.textContent = ws.branch || "-";
    }
  }

  async function executeWsRemoteOpFromGroup(wsName, endpoint, label, button, listContainer) {
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
      const res = await apiFetch(workspaceApiPath(wsName, "/status"));
      if (res && res.ok) {
        const status = await res.json();
        const idx = allWorkspaces.findIndex((w) => w.name === wsName);
        if (idx >= 0) {
          allWorkspaces[idx] = { ...allWorkspaces[idx], ...status };
          const group = listContainer.querySelector(`[data-workspace-name="${wsName}"]`);
          if (group) {
            updateModalWsGroupGitInfo(group, allWorkspaces[idx]);
          }
        }
      }
      if (selectedWorkspace === wsName) {
        await refreshWorkspaceHeader();
      }
    }
  }

  function showPickerCloneInContainer(content, mode = "visibility") {
    let pickerSelectedUrl = "";
    let pickerRepos = [];

    if (mode === "visibility") {
      const visibilityPane = document.createElement("div");
      visibilityPane.className = "clone-tab-content";
      renderWorkspaceVisibilityChecklistTo(visibilityPane, {
        onGear: (ws) => {
          contentContainer.innerHTML = "";
          setTitle(ws.name, () => switchModalTab("ws-visibility"));
          renderWorkspaceSettingsPane(contentContainer, ws, () => switchModalTab("ws-visibility"), setTitle);
        },
      });
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
          errorEl.textContent = getActionFailureMessage(data, "クローンに失敗しました");
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
