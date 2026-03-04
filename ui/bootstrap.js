async function initApp() {
  setLoadingStatus("読み込み中...");
  await loadWorkspaces({ useCache: true });
  if (!selectedWorkspace) {
    const firstVisibleWorkspace = visibleWorkspaces()[0];
    if (firstVisibleWorkspace) {
      selectedWorkspace = firstVisibleWorkspace.name;
    }
  }
  if (selectedWorkspace && !visibleWorkspaces().some((ws) => ws.name === selectedWorkspace)) {
    selectedWorkspace = null;
  }
  localStorage.removeItem("pi_console_active_tab");
  appInitializing = true;
  restoreTabsFromLocalStorageImmediate();
  appInitializing = false;
  fetchOrphanSessions();
  await Promise.all([
    updateHeaderForTab(activeTabId),
    ensureSnippetsLoaded(),
  ]);
  updateQuickInputVisibility();
  fitActiveTerminal();
  setTimeout(fitActiveTerminal, 300);
  if (sessionStorage.getItem("pi_console_server_reloaded")) {
    sessionStorage.removeItem("pi_console_server_reloaded");
    showToast("サーバーに再接続しました", "success");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
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
      token = "";
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
