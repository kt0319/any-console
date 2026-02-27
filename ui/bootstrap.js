async function initApp() {
  setLoadingStatus("ワークスペースを読み込み中...");
  await loadWorkspaces();
  if (!selectedWorkspace) {
    const firstVisibleWorkspace = visibleWorkspaces()[0];
    if (firstVisibleWorkspace) {
      selectedWorkspace = firstVisibleWorkspace.name;
    }
  }
  if (selectedWorkspace && !visibleWorkspaces().some((ws) => ws.name === selectedWorkspace)) {
    selectedWorkspace = null;
  }
  setLoadingStatus("ワークスペース情報を取得中...");
  await refreshWorkspaceHeader();
  localStorage.removeItem("pi_console_active_tab");
  setLoadingStatus("タブを復元中...");
  await fetchOrphanSessions();
  setLoadingStatus("ジョブを読み込み中...");
  await loadJobsForWorkspace();
  updateGitBarVisibility();
  updateQuickInputVisibility();
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
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) closeSettings();
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
  $("git-log-file-browser-toggle").addEventListener("click", () => GitLogModal.openFileBrowserPane());
  $("git-log-branch-btn").addEventListener("click", () => GitLogModal.openLocalBranchPane());
  $("fetch-btn").addEventListener("click", () => GitCore.gitFetch());
  $("stash-btn").addEventListener("click", () => GitLogModal.openStashPane());
  $("pull-btn").addEventListener("click", () => GitCore.gitPull());
  $("set-upstream-btn").addEventListener("click", () => GitCore.gitSetUpstream());
  $("push-upstream-btn").addEventListener("click", () => GitCore.gitPushUpstream());
  $("push-btn").addEventListener("click", () => GitCore.gitPush());
  initQuickInput();
  $("header-commit-msg").addEventListener("click", () => GitLogModal.openGitLogModal());
  $("git-log-close").addEventListener("click", () => GitLogModal.closeGitLogModal());
  $("git-log-list-modal").addEventListener("scroll", (e) => {
    const el = e.target;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      GitLogModal.loadMoreGitLog();
    }
  });
  $("git-log-create-branch-submit").addEventListener("click", () => GitLogModal.submitCreateBranch());

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
