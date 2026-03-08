// @ts-check
import { selectedWorkspace, allWorkspaces, splitMode, openTabs, activeTabId } from './state-core.js';
import { apiFetch, workspaceApiPath, getActionFailureMessage, setListStatus } from './api-client.js';
import { showToast, escapeHtml, renderActionButtons, showFormError, hideFormError, $, formatCommitTime, setupModalSwipeClose, createModalTrap } from './utils.js';
import { GIT_LOG_ENTRIES_PER_PAGE } from './state-git.js';

// Circular deps (only used in function bodies)
import { GitCore } from './git.js';
import { openCommitDiffModal, setDiffViewerMode, getActiveDiffRef, renderDiffViewerMessage, clearActiveDiffRef, closeCommitForm } from './git-diff.js';
import { refreshWorkspaceHeader } from './workspace.js';
import { syncWorkspaceForTab } from './terminal-tab-header.js';
import { loadDirectoryInDiffPane } from './git-file-browser.js';

const GIT_PANE_MAP = { history: "git-history-pane", files: "git-files-pane", stash: "git-stash-pane", branch: "git-branch-pane", github: "git-github-pane" };
const _fileModalTrap = createModalTrap("file-modal", () => GitLogModal.closeFileModal());

export const GitLogModal = {
  state: {
    diffPaneTitle: "未コミットの変更",
    gitLogLoadedWorkspace: null,
    createBranchFromHash: null,
    history: {
      loaded: 0,
      isLoading: false,
      hasMore: true,
      seenHashes: new Set(),
    },
  },

  /**
   * Toggles the commit action menu for a given history entry.
   * @param {HTMLElement} entry - The commit list entry element.
   * @param {string} hash - The commit hash.
   * @param {string} msg - The commit message.
   * @param {string[]} [branches] - Branch names associated with this commit.
   */
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
    });

    renderActionButtons(menuEl, actions);
    entry.after(menuEl);
    menuEl.style.display = "flex";
  },

  /**
   * Closes the file modal and resets all related state.
   */
  closeFileModal() {
    _fileModalTrap.close();
    GitLogModal.resetActionMenu();
    closeCommitForm();
    GitLogModal.setModalTitle("");
    GitLogModal.state.createBranchFromHash = null;
    GitLogModal.resetCreateBranchArea();
    GitLogModal.state.onBack = null;
    GitLogModal.closeGraphView();
    syncWorkspaceForTab(activeTabId);
    refreshWorkspaceHeader({ reloadBranches: false });
  },

  /**
   * Hides and clears the commit action menu.
   */
  resetActionMenu() {
    const menuEl = $("git-commit-action-menu");
    if (!menuEl) return;
    menuEl.style.display = "none";
    menuEl.innerHTML = "";
  },

  /**
   * Restores the create branch area to its original position in the history pane.
   */
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

  /**
   * Hides and resets the create branch area and restores any displaced host children.
   */
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

  /**
   * Toggles visibility of the create branch area for the given commit hash.
   * @param {string} hash - The commit hash to branch from.
   */
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

  /**
   * Submits the create branch form, calling the API to create a new branch.
   * @returns {Promise<void>}
   */
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
      GitLogModal.closeFileModal();
      await GitCore.refreshAfterGitOp();
    } catch (e) {
      showFormError("git-branch-error", e.message);
    } finally {
      $("git-create-branch-submit").disabled = false;
    }
  },

  /**
   * Ensures the modal content element is visible.
   */
  ensureDiffTabVisible() {
    const modalContent = $("file-modal-content");
    if (modalContent) modalContent.style.display = "";
  },

  /**
   * Sets the modal title text, optionally with a back arrow and click handler.
   * @param {string} title - The title text.
   * @param {{ back?: boolean, onClick?: (() => void) | null }} [options]
   */
  setModalTitle(title, options = {}) {
    const titleEl = $("file-modal").querySelector(".modal-title");
    if (!titleEl) return;
    const { back = false, onClick = null } = options;
    titleEl.textContent = "";
    titleEl.classList.toggle("modal-title-back", !!back);
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

  /**
   * Returns true if the currently selected workspace is a git repository.
   * @returns {boolean}
   */
  isCurrentWorkspaceGitRepo() {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    return ws && ws.is_git_repo === true;
  },

  /**
   * Returns the modal title string (currently selected workspace name).
   * @returns {string}
   */
  modalTitle() {
    return selectedWorkspace || "";
  },

  /**
   * Shows the history pane at the top of the diff modal.
   */
  showDiffHistoryTop() {
    const onBack = GitLogModal.state.onBack;
    GitLogModal.setDiffTopMode("history", {
      title: GitLogModal.modalTitle(),
      back: !!onBack,
      onClick: onBack || null,
    });
  },

  /**
   * Shows the files pane at the top of the diff modal.
   */
  showDiffFilesTop() {
    GitLogModal.closeGraphView();
    const isGit = GitLogModal.isCurrentWorkspaceGitRepo();
    GitLogModal.setDiffTopMode("files", {
      title: isGit ? (GitLogModal.state.diffPaneTitle || "差分") : GitLogModal.modalTitle(),
      back: isGit,
      onClick: isGit ? () => GitLogModal.returnToDiffHistoryTop() : null,
    });
  },

  /**
   * Sets the active top-level pane mode and updates the modal title.
   * @param {string} mode - One of the keys in GIT_PANE_MAP.
   * @param {{ title: string, back?: boolean, onClick?: (() => void) | null }} titleOptions
   */
  setDiffTopMode(mode, titleOptions) {
    $("git-upper-pane").style.display = "";
    GitLogModal.toggleDiffTopPane(mode);
    GitLogModal.resetActionMenu();
    GitLogModal.resetCreateBranchArea();
    GitLogModal.setModalTitle(titleOptions.title, {
      back: !!titleOptions.back,
      onClick: titleOptions.onClick || null,
    });
    const lowerPane = document.querySelector(".diff-lower-pane");
    if (lowerPane) {
      lowerPane.style.display = mode === "github" ? "none" : "";
    }
  },

  /**
   * Shows only the pane corresponding to the given mode, hides all others.
   * @param {string} mode - One of the keys in GIT_PANE_MAP.
   */
  toggleDiffTopPane(mode) {
    const targetId = GIT_PANE_MAP[mode];
    for (const [, paneId] of Object.entries(GIT_PANE_MAP)) {
      const pane = $(paneId);
      if (!pane) continue;
      pane.style.display = paneId === targetId ? "" : "none";
    }
  },

  /**
   * Navigates back to the history pane and ensures the commit log is loaded.
   * @returns {Promise<void>}
   */
  async returnToDiffHistoryTop() {
    GitLogModal.showDiffHistoryTop();
    await GitLogModal.ensureCommitLogReady();
  },

  /**
   * Loads the commit log if it has not been loaded yet or the workspace has changed.
   * @returns {Promise<void>}
   */
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

  /**
   * Opens a sub-pane with the given mode and title, with a back button to close it.
   * @param {string} mode - One of the keys in GIT_PANE_MAP.
   * @param {string} title - The pane title.
   */
  showSubPane(mode, title) {
    GitLogModal.ensureDiffTabVisible();
    GitLogModal.setDiffTopMode(mode, {
      title,
      back: true,
      onClick: () => GitLogModal.closeSubPane(),
    });
  },

  /**
   * Closes the current sub-pane, returning to the appropriate parent pane.
   * @returns {Promise<void>}
   */
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

  /**
   * Shows the diff/files pane with the given title.
   * @param {string} [title] - The pane title; defaults to "未コミットの変更".
   */
  showDiffPane(title) {
    GitLogModal.state.diffPaneTitle = title || "未コミットの変更";
    GitLogModal.ensureDiffTabVisible();
    GitLogModal.showDiffFilesTop();
  },

  /**
   * Opens the main file modal, loading the directory listing and commit log.
   * @param {{ onBack?: (() => void) | null }} [options]
   * @returns {Promise<void>}
   */
  async openFileModal({ onBack } = {}) {
    if (!selectedWorkspace) return;
    GitLogModal.state.onBack = onBack || null;
    GitLogModal.ensureDiffTabVisible();
    _fileModalTrap.open();
    clearActiveDiffRef();

    if (GitLogModal.isCurrentWorkspaceGitRepo()) {
      GitLogModal.showDiffHistoryTop();
      GitLogModal.updateStashIndicators();
      import('./git-github.js').then((m) => m.updateGitHubButtonVisibility());
      GitLogModal.state.history.hasMore = false;
      await Promise.all([loadDirectoryInDiffPane(""), GitLogModal.reloadGitLog()]);
    } else {
      const onBack = GitLogModal.state.onBack;
      GitLogModal.setDiffTopMode("files", {
        title: GitLogModal.modalTitle(),
        back: !!onBack,
        onClick: onBack || null,
      });
      $("git-upper-pane").style.display = "none";
      await loadDirectoryInDiffPane("");
    }
  },
};
