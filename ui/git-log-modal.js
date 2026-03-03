const GIT_PANE_MAP = { history: "git-history-pane", files: "git-files-pane", stash: "git-stash-pane", branch: "git-branch-pane" };

const GitLogModal = {
  state: {
    diffPaneTitle: "未コミットの変更",
    diffTopMode: "history",
    gitLogLoadedWorkspace: null,
    createBranchFromHash: null,
    history: {
      loaded: 0,
      isLoading: false,
      hasMore: true,
      seenHashes: new Set(),
    },
  },

  toggleCommitActionMenu(entry, hash, msg, branches = []) {
    const list = $("git-history-list");
    const menuEl = $("git-commit-action-menu");
    if (!menuEl) return;
    const wasOpen = entry.classList.contains("action-open");

    if (list) {
      list.querySelectorAll(".git-log-commit").forEach((e) => e.classList.remove("action-open"));
    }

    if (wasOpen) {
      menuEl.style.display = "none";
      menuEl.innerHTML = "";
      GitLogModal.resetCreateBranchArea();
      return;
    }

    entry.classList.add("action-open");
    menuEl.innerHTML = "";
    GitLogModal.resetCreateBranchArea();

    const actions = GitCore.buildCommitActions(hash, {
      branches,
      extraActions: [{ label: "diff", cls: "", fn: () => openCommitDiffModal(hash, msg) }],
    });

    renderActionButtons(menuEl, actions);
    entry.after(menuEl);
    menuEl.style.display = "flex";
  },

  closeGitModal() {
    $("git-modal").style.display = "none";
    GitLogModal.resetActionMenu();
    closeCommitForm();
    GitLogModal.setModalTitle("");
    GitLogModal.state.createBranchFromHash = null;
    GitLogModal.resetCreateBranchArea();
    GitLogModal.state.onBack = null;
    GitLogModal.closeGraphView();
  },

  resetActionMenu() {
    const menuEl = $("git-commit-action-menu");
    if (!menuEl) return;
    menuEl.style.display = "none";
    menuEl.innerHTML = "";
  },

  restoreCreateBranchAreaPosition() {
    const area = $("git-create-branch-area");
    const menuEl = $("git-commit-action-menu");
    const historyPane = $("git-history-pane");
    if (!area || !menuEl || !historyPane) return;
    if (area.parentElement !== historyPane) {
      if (menuEl.parentElement === historyPane) {
        historyPane.insertBefore(area, menuEl.nextSibling);
      } else {
        historyPane.appendChild(area);
      }
    }
  },

  resetCreateBranchArea() {
    const area = $("git-create-branch-area");
    const submitBtn = $("git-create-branch-submit");
    const input = $("git-branch-name-input");
    if (area) area.style.display = "none";
    if (submitBtn) submitBtn.style.display = "none";
    if (input) input.value = "";
    GitLogModal.restoreCreateBranchAreaPosition();
    hideFormError("git-branch-error");
    const host = GitLogModal.state._branchAreaHost;
    if (host) {
      const children = GitLogModal.state._branchAreaHostChildren || [];
      while (host.firstChild) host.removeChild(host.firstChild);
      for (const child of children) host.appendChild(child);
      GitLogModal.state._branchAreaHost = null;
      GitLogModal.state._branchAreaHostChildren = null;
    }
  },

  toggleCreateBranchArea(hash) {
    const area = $("git-create-branch-area");
    const submitBtn = $("git-create-branch-submit");
    const menuEl = $("git-commit-action-menu");
    const diffActionsEl = $("diff-actions");
    const triggerBtn = menuEl?.querySelector('[data-action-key="create-branch"]')
      || diffActionsEl?.querySelector('[data-action-key="create-branch"]');
    const hostEl = triggerBtn?.closest(".commit-action-menu, .diff-actions");
    const visible = area.style.display !== "none";
    if (visible) {
      GitLogModal.resetCreateBranchArea();
    } else {
      GitLogModal.state.createBranchFromHash = hash || null;
      if (hostEl) {
        GitLogModal.state._branchAreaHost = hostEl;
        GitLogModal.state._branchAreaHostChildren = Array.from(hostEl.childNodes);
        while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
        hostEl.appendChild(area);
        hostEl.style.display = "";
      }
      area.style.display = "block";
      if (submitBtn) submitBtn.style.display = "";
    }
  },

  async submitCreateBranch() {
    if (!selectedWorkspace) return;
    const branchName = $("git-branch-name-input").value.trim();

    if (!branchName) {
      showFormError("git-branch-error", "ブランチ名を入力してください");
      return;
    }
    if (!/^[a-zA-Z0-9_./-]+$/.test(branchName)) {
      showFormError("git-branch-error", "ブランチ名に使えない文字が含まれています");
      return;
    }

    hideFormError("git-branch-error");
    $("git-create-branch-submit").disabled = true;

    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/create-branch"), {
        method: "POST",
        body: { branch: branchName },
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.status !== "ok") {
        showFormError("git-branch-error", getActionFailureMessage(data, "ブランチ作成に失敗しました"));
        return;
      }
      GitLogModal.closeGitModal();
      await GitCore.refreshAfterGitOp();
    } catch (e) {
      showFormError("git-branch-error", e.message);
    } finally {
      $("git-create-branch-submit").disabled = false;
    }
  },

  ensureDiffTabVisible() {
    const diffTab = $("git-modal-content");
    if (diffTab) diffTab.style.display = "";
  },

  setModalTitle(title, options = {}) {
    const titleEl = $("git-modal-title");
    if (!titleEl) return;
    const { back = false, onClick = null } = options;
    titleEl.textContent = "";
    titleEl.classList.toggle("split-modal-title-back", !!back);
    if (back) {
      const arrow = document.createElement("span");
      arrow.className = "mdi mdi-arrow-left";
      titleEl.appendChild(arrow);
      titleEl.appendChild(document.createTextNode(` ${title}`));
    } else {
      titleEl.textContent = title;
    }
    titleEl.onclick = typeof onClick === "function" ? onClick : null;
  },

  isCurrentWorkspaceGitRepo() {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    return ws && ws.is_git_repo === true;
  },

  modalTitle() {
    return selectedWorkspace || "";
  },

  showDiffHistoryTop() {
    const onBack = GitLogModal.state.onBack;
    GitLogModal.setDiffTopMode("history", {
      title: GitLogModal.modalTitle(),
      back: !!onBack,
      onClick: onBack || null,
    });
  },

  showDiffFilesTop() {
    GitLogModal.closeGraphView();
    const isGit = GitLogModal.isCurrentWorkspaceGitRepo();
    GitLogModal.setDiffTopMode("files", {
      title: isGit ? (GitLogModal.state.diffPaneTitle || "差分") : GitLogModal.modalTitle(),
      back: isGit,
      onClick: isGit ? () => GitLogModal.returnToDiffHistoryTop() : null,
    });
  },

  setDiffTopMode(mode, titleOptions) {
    GitLogModal.state.diffTopMode = mode;
    $("git-upper-pane").style.display = "";
    GitLogModal.toggleDiffTopPane(mode);
    GitLogModal.resetActionMenu();
    GitLogModal.resetCreateBranchArea();
    GitLogModal.setModalTitle(titleOptions.title, {
      back: !!titleOptions.back,
      onClick: titleOptions.onClick || null,
    });
  },

  toggleDiffTopPane(mode) {
    const targetId = GIT_PANE_MAP[mode];
    for (const [, paneId] of Object.entries(GIT_PANE_MAP)) {
      const pane = $(paneId);
      if (!pane) continue;
      pane.style.display = paneId === targetId ? "" : "none";
    }
  },

  async returnToDiffHistoryTop() {
    GitLogModal.showDiffHistoryTop();
    await GitLogModal.ensureCommitLogReady();
  },

  async ensureCommitLogReady() {
    if (!selectedWorkspace) return;
    const listEl = $("git-history-list");
    if (!listEl) return;
    const hasEntry = !!listEl.querySelector(".git-log-entry");
    const hasText = !!listEl.textContent.trim();
    const workspaceChanged = GitLogModal.state.gitLogLoadedWorkspace !== selectedWorkspace;
    if (workspaceChanged || (!hasEntry && !hasText)) {
      await GitLogModal.reloadGitLog();
    }
  },

  showSubPane(mode, title) {
    GitLogModal.ensureDiffTabVisible();
    GitLogModal.setDiffTopMode(mode, {
      title,
      back: true,
      onClick: () => GitLogModal.closeSubPane(),
    });
  },

  async closeSubPane() {
    const createBranchArea = $("git-create-branch-area");
    if (createBranchArea && createBranchArea.style.display !== "none") {
      GitLogModal.resetCreateBranchArea();
      return;
    }
    if (getActiveDiffRef() || !GitLogModal.isCurrentWorkspaceGitRepo()) {
      GitLogModal.showDiffFilesTop();
      return;
    }
    GitLogModal.showDiffHistoryTop();
    await GitLogModal.ensureCommitLogReady();
  },

  showDiffPane(title) {
    GitLogModal.state.diffPaneTitle = title || "未コミットの変更";
    GitLogModal.ensureDiffTabVisible();
    GitLogModal.showDiffFilesTop();
  },

  async openGitModal({ onBack } = {}) {
    if (!selectedWorkspace) return;
    GitLogModal.state.onBack = onBack || null;
    GitLogModal.ensureDiffTabVisible();
    GitLogModal.showDiffHistoryTop();
    $("git-modal").style.display = "flex";
    GitLogModal.updateStashIndicators();
    clearActiveDiffRef();
    GitLogModal.state.history.hasMore = false;
    await Promise.all([loadDirectoryInDiffPane(""), GitLogModal.reloadGitLog()]);
  },

  async openFileModal() {
    if (!selectedWorkspace) return;
    GitLogModal.ensureDiffTabVisible();
    $("git-modal").style.display = "flex";
    GitLogModal.setDiffTopMode("files", { title: GitLogModal.modalTitle() });
    $("git-upper-pane").style.display = "none";
    clearActiveDiffRef();
    await loadDirectoryInDiffPane("");
  },
};
