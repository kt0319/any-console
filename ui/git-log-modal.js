const GitLogModal = {
  state: {
    isGitLogFilesLoaded: false,
    previousModalTab: "commits",
    diffPaneTitle: "未コミットの変更",
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
    menuEl.style.display = "flex";
  },

  closeGitLogModal() {
    $("git-log-modal").style.display = "none";
    $("git-log-action-menu").style.display = "none";
    $("git-log-action-menu").innerHTML = "";
    $("diff-commit-form").style.display = "none";
    const titleEl = $("git-log-modal-title");
    titleEl.classList.remove("split-modal-title-back");
    titleEl.onclick = null;

    GitLogModal.resetCreateBranchArea();
  },

  restoreCreateBranchAreaPosition() {
    const area = $("git-log-create-branch-area");
    const menuEl = $("git-log-action-menu");
    const commitsPane = $("commit-modal-tab-commits");
    if (!area || !menuEl || !commitsPane) return;
    if (area.parentElement !== commitsPane) {
      commitsPane.insertBefore(area, menuEl.nextSibling);
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
      $("git-log-branch-name").focus();
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
        showFormError("git-log-branch-error", data.detail || data.stderr || "ブランチ作成に失敗しました");
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

  switchCommitModalTab(tab) {
    const allPanes = ["commit-modal-tab-commits", "commit-modal-tab-files", "commit-modal-tab-diff", "commit-modal-tab-diff-view", "commit-modal-tab-stash", "commit-modal-tab-branch"];
    const titleEl = $("git-log-modal-title");
    titleEl.textContent = "履歴";
    titleEl.classList.remove("split-modal-title-back");
    titleEl.onclick = null;
    for (const id of allPanes) {
      const pane = $(id);
      if (pane) pane.style.display = "none";
    }
    $("commit-modal-tab-" + tab).style.display = "";
  },

  openFileBrowserPane() {
    GitLogModal.state.previousModalTab = "commits";
    GitLogModal.showSubPane("commit-modal-tab-files", "ファイル");
    if (!GitLogModal.state.isGitLogFilesLoaded) {
      GitLogModal.state.isGitLogFilesLoaded = true;
      loadDirectoryInModal("");
    }
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

  showSubPane(paneId, title) {
    const allPanes = ["commit-modal-tab-commits", "commit-modal-tab-files", "commit-modal-tab-diff", "commit-modal-tab-diff-view", "commit-modal-tab-stash", "commit-modal-tab-branch"];
    for (const id of allPanes) {
      const pane = $(id);
      if (pane) pane.style.display = "none";
    }
    $(paneId).style.display = "";
    const titleEl = $("git-log-modal-title");
    titleEl.textContent = "";
    titleEl.classList.add("split-modal-title-back");
    const arrow = document.createElement("span");
    arrow.className = "mdi mdi-arrow-left";
    titleEl.appendChild(arrow);
    titleEl.appendChild(document.createTextNode(" " + title));
    titleEl.onclick = () => GitLogModal.closeSubPane();
  },

  async closeSubPane() {
    const createBranchArea = $("git-log-create-branch-area");
    if (createBranchArea && createBranchArea.style.display !== "none") {
      GitLogModal.resetCreateBranchArea();
      return;
    }
    if (GitLogModal.state.previousModalTab === "diff") {
      GitLogModal.state.previousModalTab = "commits";
      GitLogModal.showDiffPane(GitLogModal.state.diffPaneTitle);
      return;
    }
    const nextTab = GitLogModal.state.previousModalTab;
    GitLogModal.switchCommitModalTab(nextTab);
    if (nextTab === "commits") {
      await GitLogModal.ensureCommitLogReady();
    }
  },

  showDiffPane(title) {
    GitLogModal.state.diffPaneTitle = title || "未コミットの変更";
    GitLogModal.showSubPane("commit-modal-tab-diff", GitLogModal.state.diffPaneTitle);
  },

  closeDiffPane() {
    GitLogModal.closeSubPane();
  },

  async openGitLogModal() {
    if (!selectedWorkspace) return;
    GitLogModal.state.isGitLogFilesLoaded = false;
    GitLogModal.switchCommitModalTab("commits");
    $("git-log-modal").style.display = "flex";
    GitLogModal.updateGitLogBranchLabel();
    await GitLogModal.reloadGitLog();
  },

  async openGitLogModalFiles() {
    if (!selectedWorkspace) return;
    GitLogModal.state.isGitLogFilesLoaded = false;
    $("git-log-modal").style.display = "flex";
    GitLogModal.updateGitLogBranchLabel();
    GitLogModal.openFileBrowserPane();
  },
};
