async function initApp() {
  setLoadingStatus("ワークスペースを読み込み中...");
  await loadWorkspaces();
  if (selectedWorkspace && !visibleWorkspaces().some((ws) => ws.name === selectedWorkspace)) {
    selectedWorkspace = null;
    localStorage.removeItem("pi_console_workspace");
  }
  setLoadingStatus("ワークスペース情報を取得中...");
  renderWorkspaceSelects();
  await updateHeaderInfo();
  setLoadingStatus("ジョブを読み込み中...");
  await loadJobsForWorkspace();
  renderJobMenu();
  const savedTabs = JSON.parse(localStorage.getItem(TERMINAL_TABS_KEY) || "[]");
  if (savedTabs.length > 0) {
    setLoadingStatus("ターミナルを復元中...");
    await restoreTerminalTabs();
  }
  await fetchOrphanSessions();
  if (!selectedWorkspace) {
    setLoadingStatus("ワークスペースを選択してください");
  } else {
    $("output").innerHTML = '<div class="empty-state"></div>';
  }
}

function updateViewportHeight() {
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${vh}px`);
}

document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

document.addEventListener("DOMContentLoaded", async () => {
  updateViewportHeight();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateViewportHeight);
  }
  $("login-btn").addEventListener("click", login);
  $("token-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  $("job-confirm-cancel").addEventListener("click", closeJobConfirmModal);
  $("job-confirm-cancel-x").addEventListener("click", closeJobConfirmModal);
  $("job-confirm-run").addEventListener("click", () => {
    const args = collectConfirmArgs();
    closeJobConfirmModal();
    runJob(null, args);
  });
  $("menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  $("menu-settings").addEventListener("click", () => {
    closeMenu();
    openSettings();
  });
  for (const id of ["github-link", "github-issues", "github-pulls", "github-actions"]) {
    $(id).addEventListener("click", closeMenu);
  }
  document.addEventListener("click", closeMenu);
  window.addEventListener("blur", closeMenu);
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-clone").addEventListener("click", () => {
    closeSettings();
    openCloneModal();
  });
  $("settings-visibility").addEventListener("click", openSettingsWsVisibility);
  $("settings-server-info").addEventListener("click", openSettingsServerInfo);
  $("settings-logout").addEventListener("click", settingsLogout);
  $("clone-cancel").addEventListener("click", closeCloneModal);
  $("clone-submit").addEventListener("click", submitClone);
  for (const tab of document.querySelectorAll(".clone-tab")) {
    tab.addEventListener("click", () => switchCloneTab(tab.dataset.tab));
  }
  $("branch-modal-close").addEventListener("click", closeBranchModal);
  $("diff-close").addEventListener("click", closeDiffModal);
  $("job-create-cancel").addEventListener("click", closeJobCreateModal);
  $("job-create-submit").addEventListener("click", submitJobCreate);
  $("ws-select-btn").addEventListener("click", toggleWsSelectDropdown);
  document.addEventListener("click", (e) => {
    if (!$("ws-select-wrap").contains(e.target)) {
      closeWsSelectDropdown();
    }
  });
  $("fetch-btn").addEventListener("click", gitFetch);
  $("pull-btn").addEventListener("click", gitPull);
  $("push-btn").addEventListener("click", gitPush);
  initQuickInput();
  $("header-commit-msg").addEventListener("click", openGitLogModal);
  $("git-log-close").addEventListener("click", closeGitLogModal);
  $("git-log-list-modal").addEventListener("scroll", (e) => {
    const el = e.target;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      loadMoreGitLog();
    }
  });
  $("git-log-create-branch-submit").addEventListener("click", submitCreateBranch);

  if (token) {
    const result = await checkToken();
    if (result.ok) {
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
