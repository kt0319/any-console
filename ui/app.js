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
  updateQuickInputVisibility();
}

function updateViewportHeight() {
  const vv = window.visualViewport;
  const keyboardOpen = vv && (window.innerHeight - vv.height > 100);
  document.querySelector(".main-panel").classList.toggle("keyboard-open", keyboardOpen);
  updateKeyboardIndicator(keyboardOpen);
  fitActiveTerminal();
}

function fitActiveTerminal() {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (tab && tab.type === "terminal" && tab.fitAddon) {
    try { tab.fitAddon.fit(); } catch {}
    tab.term.scrollToBottom();
  }
}

function updateKeyboardIndicator(keyboardOpen) {
  let el = $("keyboard-indicator");
  if (!el) {
    el = document.createElement("div");
    el.id = "keyboard-indicator";
    el.className = "keyboard-indicator";
    el.textContent = "テキスト入力中";
    document.body.appendChild(el);
  }
  if (keyboardOpen) {
    el.style.display = "";
    const vv = window.visualViewport;
    if (vv) el.style.top = (vv.offsetTop + vv.height - 52) + "px";
    if (window.showQuickTextInput) window.showQuickTextInput();
  } else {
    el.style.display = "none";
  }
}

document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
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
  $("menu-btn").addEventListener("click", () => toggleMenu());
  $("menu-close").addEventListener("click", closeMenu);
  $("menu-modal").addEventListener("click", (e) => {
    if (e.target === $("menu-modal")) closeMenu();
  });
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-clone").addEventListener("click", () => {
    closeSettings();
    openCloneModal();
  });
  applyPanelBottom();
  $("clone-cancel").addEventListener("click", closeCloneModal);
  $("clone-submit").addEventListener("click", submitClone);
  for (const tab of document.querySelectorAll(".clone-tab")) {
    tab.addEventListener("click", () => switchCloneTab(tab.dataset.tab));
  }
  $("branch-modal-close").addEventListener("click", closeBranchModal);
  $("diff-close").addEventListener("click", closeDiffModal);
  $("item-create-cancel").addEventListener("click", closeItemCreateModal);
  $("item-create-submit").addEventListener("click", submitItemCreate);
  for (const radio of document.querySelectorAll('input[name="item-create-type"]')) {
    radio.addEventListener("change", () => switchItemCreateType(radio.value));
  }
  $("icon-picker-close").addEventListener("click", closeIconPicker);
  $("icon-picker-modal").addEventListener("click", (e) => {
    if (e.target === $("icon-picker-modal")) closeIconPicker();
  });
  $("link-icon-select-btn").addEventListener("click", () => {
    openIconPicker(({ icon, color }) => {
      selectedLinkIcon = icon;
      selectedLinkIconColor = color;
      setIconSelectPreview("link-icon-select-btn", icon, color);
    }, selectedLinkIconColor);
  });
  $("job-icon-select-btn").addEventListener("click", () => {
    openIconPicker(({ icon, color }) => {
      selectedJobIcon = icon;
      selectedJobIconColor = color;
      setIconSelectPreview("job-icon-select-btn", icon, color);
    }, selectedJobIconColor);
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
