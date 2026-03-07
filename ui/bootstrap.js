// @ts-check
import { token, setToken, selectedWorkspace, setSelectedWorkspace, setAppInitializing, activeTabId, isPwa } from './state-core.js';
import { $, setLoadingStatus, setupModalSwipeClose, showToast, showLogin, showApp } from './utils.js';
import { loadWorkspaces, refreshWorkspaceHeader, visibleWorkspaces } from './workspace.js';
import { ensureSnippetsLoaded } from './state-input.js';
import { fetchOrphanSessions, updateQuickInputVisibility } from './terminal-connection.js';
import { updateHeaderForTab } from './terminal-tab-header.js';
import { renderTabBar } from './terminal-tabs.js';
import { fitActiveTerminal, updateViewportHeight } from './viewport.js';
import { initQuickInput } from './quick-input.js';
import { login, checkToken, setServerInfo, loadToken, clearToken } from './auth.js';
import { openJobConfirmModal, closeJobConfirmModal, collectConfirmArgs, runJob } from './jobs.js';
import { closeSettings, initDeviceName, initEditorSshHost, applyPanelBottom } from './settings.js';
import { GitLogModal } from './git-log-modal.js';
import { closeCommitForm, submitCommit } from './git-diff.js';
import { closeIconPicker, clearIconPicker, submitIconPicker } from './icon-picker.js';
import { GitCore } from './git.js';
import { initGitHubPane } from './git-github.js';
import { openTabEditModal } from './terminal-tab-modal.js';

/**
 * Initializes the application after successful authentication.
 * Loads workspaces, restores terminal tabs, and sets up the UI state.
 * @returns {Promise<void>}
 */
export async function initApp() {
  setLoadingStatus("読み込み中...");
  try {
    await loadWorkspaces({ useCache: true });
    if (!selectedWorkspace) {
      const firstVisibleWorkspace = visibleWorkspaces()[0];
      if (firstVisibleWorkspace) {
        setSelectedWorkspace(firstVisibleWorkspace.name);
      }
    }
    if (selectedWorkspace && !visibleWorkspaces().some((ws) => ws.name === selectedWorkspace)) {
      setSelectedWorkspace(null);
    }
    localStorage.removeItem("pi_console_active_tab");
    localStorage.removeItem("pi_console_terminal_openTabs");
    setAppInitializing(true);
    await fetchOrphanSessions();
    setAppInitializing(false);
    await Promise.all([
      updateHeaderForTab(activeTabId),
      ensureSnippetsLoaded(),
      initEditorSshHost(),
    ]);
    updateQuickInputVisibility();
    fitActiveTerminal();
    setTimeout(fitActiveTerminal, 300);
  } catch (e) {
    console.error("initApp failed:", e);
    showToast("初期化に失敗しました。ページを再読み込みしてください");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (isPwa) document.documentElement.classList.add("pwa");
  updateViewportHeight();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateViewportHeight);
    window.visualViewport.addEventListener("scroll", updateViewportHeight);
  }
  window.addEventListener("resize", updateViewportHeight);
  window.addEventListener("orientationchange", () => setTimeout(updateViewportHeight, 120));

  $("login-btn").addEventListener("click", login);
  $("job-confirm-cancel").addEventListener("click", closeJobConfirmModal);
  $("job-confirm-cancel-x").addEventListener("click", closeJobConfirmModal);
  $("job-confirm-run").addEventListener("click", () => {
    const args = collectConfirmArgs();
    closeJobConfirmModal();
    runJob(null, args);
  });
  initDeviceName();
  $("settings-close").addEventListener("click", closeSettings);
  const settingsModal = $("settings-modal");
  const settingsDialog = settingsModal.querySelector(".modal");
  settingsDialog.addEventListener("click", (e) => e.stopPropagation());
  settingsDialog.addEventListener("touchend", (e) => e.stopPropagation(), { passive: true });
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
  });
  applyPanelBottom();
  $("diff-commit-cancel").addEventListener("click", closeCommitForm);
  $("diff-commit-submit").addEventListener("click", submitCommit);
  $("icon-picker-close").addEventListener("click", closeIconPicker);
  $("icon-picker-clear").addEventListener("click", clearIconPicker);
  $("icon-picker-modal").addEventListener("click", (e) => {
    if (e.target === $("icon-picker-modal")) closeIconPicker();
  });
  $("icon-picker-url-ok").addEventListener("click", submitIconPicker);
  $("pull-btn").addEventListener("click", () => GitCore.gitPull());
  $("set-upstream-btn").addEventListener("click", () => GitCore.gitSetUpstream());
  $("push-upstream-btn").addEventListener("click", () => GitCore.gitPushUpstream());
  $("push-btn").addEventListener("click", () => GitCore.gitPush());
  initQuickInput();
  $("header-commit-msg").addEventListener("click", () => GitLogModal.openGitModal({
    onBack: () => {
      GitLogModal.closeGitModal();
      openTabEditModal("workspace");
    },
  }));
  $("git-modal-close").addEventListener("click", () => GitLogModal.closeGitModal());
  initGitHubPane();
  $("git-modal").addEventListener("click", (e) => {
    if (e.target === $("git-modal")) GitLogModal.closeGitModal();
  });
  function bindScrollLoadMore(id, loadMore) {
    $(id).addEventListener("scroll", (e) => {
      const el = e.target;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) loadMore();
    });
  }
  bindScrollLoadMore("git-history-list", () => GitLogModal.loadMoreGitLog());
  bindScrollLoadMore("git-graph-list", () => GitLogModal.loadMoreGraphLog());
  $("git-create-branch-submit").addEventListener("click", () => GitLogModal.submitCreateBranch());
  $("git-create-branch-close").addEventListener("click", () => GitLogModal.resetCreateBranchArea());

  setupModalSwipeClose($("settings-modal"), closeSettings);
  setupModalSwipeClose($("git-modal"), () => GitLogModal.closeGitModal());
  setupModalSwipeClose($("job-confirm-modal"), closeJobConfirmModal);
  setupModalSwipeClose($("icon-picker-modal"), closeIconPicker);

  if (token) {
    const result = await checkToken();
    if (result.ok) {
      setServerInfo(result.hostname, result.version);
      showApp();

      await initApp();
    } else if (!result.auth) {
      setToken("");
      clearToken();
      showLogin();
    } else {
      showToast(result.error);
      showApp();

      await initApp();
    }
  } else {
    showLogin();
  }
});
