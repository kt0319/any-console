const DIFF_TOP_PANE_IDS = ["diff-history-pane", "diff-files-pane", "diff-stash-pane", "diff-branch-pane"];

const GitLogModal = {
  state: {
    diffPaneTitle: "未コミットの変更",
    diffTopMode: "history",
    gitLogLoadedWorkspace: null,
    history: {
      loaded: 0,
      isLoading: false,
      hasMore: true,
      seenHashes: new Set(),
    },
  },

  toggleCommitActionMenu(entry, hash, msg, branches = []) {
    const list = $("git-log-list-modal");
    const menuEl = $("git-log-action-menu");
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

  closeGitLogModal() {
    $("git-log-modal").style.display = "none";
    GitLogModal.resetActionMenu();
    closeCommitForm();
    GitLogModal.setModalTitle("");
    GitLogModal.resetCreateBranchArea();
    GitLogModal.state.onBack = null;
  },

  resetActionMenu() {
    const menuEl = $("git-log-action-menu");
    if (!menuEl) return;
    menuEl.style.display = "none";
    menuEl.innerHTML = "";
  },

  restoreCreateBranchAreaPosition() {
    const area = $("git-log-create-branch-area");
    const menuEl = $("git-log-action-menu");
    const historyPane = $("diff-history-pane");
    if (!area || !menuEl || !historyPane) return;
    if (area.parentElement !== historyPane) {
      historyPane.insertBefore(area, menuEl.nextSibling);
    }
  },

  resetCreateBranchArea() {
    const area = $("git-log-create-branch-area");
    const submitBtn = $("git-log-create-branch-submit");
    const input = $("git-log-branch-name");
    if (area) area.style.display = "none";
    if (submitBtn) submitBtn.style.display = "none";
    if (input) input.value = "";
    GitLogModal.restoreCreateBranchAreaPosition();
    hideFormError("git-log-branch-error");
  },

  toggleCreateBranchArea(hash) {
    const area = $("git-log-create-branch-area");
    const submitBtn = $("git-log-create-branch-submit");
    const menuEl = $("git-log-action-menu");
    const diffActionsEl = $("diff-actions");
    const triggerBtn = menuEl?.querySelector('[data-action-key="create-branch"]')
      || diffActionsEl?.querySelector('[data-action-key="create-branch"]');
    const hostEl = triggerBtn?.closest(".commit-action-menu, .diff-actions");
    const visible = area.style.display !== "none";
    if (visible) {
      GitLogModal.resetCreateBranchArea();
    } else {
      createBranchFromHash = hash || null;
      if (hostEl?.parentElement) {
        hostEl.insertAdjacentElement("afterend", area);
      }
      area.style.display = "block";
      if (submitBtn) submitBtn.style.display = "";
    }
  },

  async submitCreateBranch() {
    if (!selectedWorkspace) return;
    const branchName = $("git-log-branch-name").value.trim();

    if (!branchName) {
      showFormError("git-log-branch-error", "ブランチ名を入力してください");
      return;
    }
    if (!/^[a-zA-Z0-9_./-]+$/.test(branchName)) {
      showFormError("git-log-branch-error", "ブランチ名に使えない文字が含まれています");
      return;
    }

    hideFormError("git-log-branch-error");
    $("git-log-create-branch-submit").disabled = true;

    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/create-branch"), {
        method: "POST",
        body: { branch: branchName },
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.status !== "ok") {
        showFormError("git-log-branch-error", getActionFailureMessage(data, "ブランチ作成に失敗しました"));
        return;
      }
      GitLogModal.closeGitLogModal();
      await GitCore.refreshAfterGitOp();
    } catch (e) {
      showFormError("git-log-branch-error", e.message);
    } finally {
      $("git-log-create-branch-submit").disabled = false;
    }
  },

  ensureDiffTabVisible() {
    const diffTab = $("commit-modal-tab-diff");
    if (diffTab) diffTab.style.display = "";
  },

  setModalTitle(title, options = {}) {
    const titleEl = $("git-log-modal-title");
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
    const isGit = GitLogModal.isCurrentWorkspaceGitRepo();
    GitLogModal.setDiffTopMode("files", {
      title: isGit ? (GitLogModal.state.diffPaneTitle || "差分") : GitLogModal.modalTitle(),
      back: isGit,
      onClick: isGit ? () => GitLogModal.returnToDiffHistoryTop() : null,
    });
  },

  setDiffTopMode(mode, titleOptions) {
    GitLogModal.state.diffTopMode = mode;
    $("diff-upper-pane").style.display = "";
    GitLogModal.toggleDiffTopPane(mode);
    GitLogModal.resetActionMenu();
    GitLogModal.resetCreateBranchArea();
    GitLogModal.setModalTitle(titleOptions.title, {
      back: !!titleOptions.back,
      onClick: titleOptions.onClick || null,
    });
  },

  toggleDiffTopPane(mode) {
    for (const paneId of DIFF_TOP_PANE_IDS) {
      const pane = $(paneId);
      if (!pane) continue;
      pane.style.display = paneId === `diff-${mode}-pane` ? "" : "none";
    }
  },

  async returnToDiffHistoryTop() {
    GitLogModal.showDiffHistoryTop();
    await GitLogModal.ensureCommitLogReady();
  },

  async ensureCommitLogReady() {
    if (!selectedWorkspace) return;
    const listEl = $("git-log-list-modal");
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
    const createBranchArea = $("git-log-create-branch-area");
    if (createBranchArea && createBranchArea.style.display !== "none") {
      GitLogModal.resetCreateBranchArea();
      return;
    }
    if (getActiveDiffRef()) {
      GitLogModal.showDiffFilesTop();
      return;
    }
    if (!GitLogModal.isCurrentWorkspaceGitRepo()) {
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

  async openGitLogModal({ onBack } = {}) {
    if (!selectedWorkspace) return;
    GitLogModal.state.onBack = onBack || null;
    GitLogModal.ensureDiffTabVisible();
    GitLogModal.showDiffHistoryTop();
    $("git-log-modal").style.display = "flex";
    GitLogModal.updateStashIndicators();
    clearActiveDiffRef();
    GitLogModal.state.history.hasMore = false;
    await Promise.all([loadDirectoryInDiffPane(""), GitLogModal.reloadGitLog()]);
  },

  async openFileBrowserModal() {
    if (!selectedWorkspace) return;
    GitLogModal.ensureDiffTabVisible();
    $("git-log-modal").style.display = "flex";
    GitLogModal.setDiffTopMode("files", { title: GitLogModal.modalTitle() });
    $("diff-upper-pane").style.display = "none";
    clearActiveDiffRef();
    await loadDirectoryInDiffPane("");
  },
};
