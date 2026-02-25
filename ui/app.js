async function initApp() {
  setLoadingStatus("ワークスペースを読み込み中...");
  await loadWorkspaces();
  if (selectedWorkspace && !visibleWorkspaces().some((ws) => ws.name === selectedWorkspace)) {
    selectedWorkspace = null;
  }
  setLoadingStatus("ワークスペース情報を取得中...");
  await updateHeaderInfo();
  setLoadingStatus("ジョブを読み込み中...");
  await loadJobsForWorkspace();
  localStorage.removeItem("pi_console_terminal_tabs");
  localStorage.removeItem("pi_console_active_tab");
  ensurePickerTab();
  await fetchOrphanSessions();
  updateQuickInputVisibility();
  if (sessionStorage.getItem("pi_console_server_reloaded")) {
    sessionStorage.removeItem("pi_console_server_reloaded");
    showToast("サーバーに再接続しました");
  }
}

let prevKeyboardOpen = false;
let keyboardCloseTimer = null;
function updateViewportHeight() {
  const vv = window.visualViewport;
  const keyboardOpen = vv && (window.innerHeight - vv.height > 100);
  document.querySelector(".main-panel").classList.toggle("keyboard-open", keyboardOpen);
  repositionKeyboardInput(keyboardOpen);
  if (prevKeyboardOpen && !keyboardOpen) {
    if (keyboardCloseTimer) clearTimeout(keyboardCloseTimer);
    keyboardCloseTimer = setTimeout(() => {
      keyboardCloseTimer = null;
      doFitActiveTerminal();
    }, 500);
  } else if (!keyboardOpen) {
    fitActiveTerminal();
  }
  prevKeyboardOpen = keyboardOpen;
}

let fitDebounceTimer = null;
function fitActiveTerminal() {
  if (keyboardCloseTimer) return;
  if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
  fitDebounceTimer = setTimeout(() => {
    fitDebounceTimer = null;
    doFitActiveTerminal();
  }, 100);
}

function doFitActiveTerminal() {
  if (splitMode) {
    requestAnimationFrame(() => {
      for (const tabId of splitPaneTabIds) {
        const tab = tabs.find((t) => t.id === tabId);
        if (tab && tab.type === "terminal" && tab.fitAddon) {
          try { tab.fitAddon.fit(); } catch {}
          tab.term.scrollToBottom();
        }
      }
    });
    return;
  }
  const tab = tabs.find((t) => t.id === activeTabId);
  if (tab && tab.type === "terminal" && tab.fitAddon) {
    requestAnimationFrame(() => {
      try { tab.fitAddon.fit(); } catch {}
      tab.term.scrollToBottom();
    });
  }
}

function createKeyboardInput() {
  const wrapper = document.createElement("div");
  wrapper.id = "keyboard-input-wrapper";
  wrapper.className = "keyboard-input-wrapper";

  const stock = document.createElement("div");
  stock.className = "keyboard-input-stock";
  wrapper.appendChild(stock);

  const inputRow = document.createElement("div");
  inputRow.className = "keyboard-input-row";

  const el = document.createElement("input");
  el.type = "text";
  el.id = "keyboard-input";
  el.className = "keyboard-input";
  el.placeholder = "テキスト入力";
  el.enterKeyHint = "send";
  inputRow.appendChild(el);

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "keyboard-input-send";
  sendBtn.innerHTML = '<span class="mdi mdi-send"></span>';
  sendBtn.disabled = true;
  sendBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!el.value) return;
    const val = el.value;
    el.value = "";
    addInputHistory(val);
    sendTextToTerminal(val);
    updateBtnState();
    el.blur();
  });
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "keyboard-input-clear";
  closeBtn.innerHTML = '<span class="mdi mdi-close"></span>';
  const updateBtnState = () => {
    sendBtn.disabled = !el.value;
  };
  updateBtnState();
  el.addEventListener("input", updateBtnState);
  closeBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.value = "";
    updateBtnState();
    el.blur();
  });
  inputRow.appendChild(closeBtn);
  inputRow.appendChild(sendBtn);

  wrapper.appendChild(inputRow);

  document.body.appendChild(wrapper);

  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      const val = el.value;
      el.value = "";
      if (val) {
        addInputHistory(val);
        sendTextToTerminal(val);
      }
      updateBtnState();
      el.blur();
    }
  });
  el.addEventListener("blur", () => {
    setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) {
        wrapper.style.display = "none";
      }
    }, 150);
  });

  return el;
}

const INPUT_STOCK_PAGE_SIZE = 3;
let inputStockOffset = 0;

function renderInputStock() {
  const wrapper = document.getElementById("keyboard-input-wrapper");
  if (!wrapper) return;
  const stock = wrapper.querySelector(".keyboard-input-stock");
  const input = wrapper.querySelector(".keyboard-input");
  stock.innerHTML = "";
  if (inputHistory.length === 0) {
    stock.style.display = "none";
    return;
  }
  stock.style.display = "";

  const maxOffset = Math.max(0, inputHistory.length - INPUT_STOCK_PAGE_SIZE);
  if (inputStockOffset > maxOffset) inputStockOffset = maxOffset;

  const hasPrev = inputStockOffset + INPUT_STOCK_PAGE_SIZE < inputHistory.length;
  const hasNext = inputStockOffset > 0;

  const navRow = document.createElement("div");
  navRow.className = "keyboard-input-stock-nav-row";
  navRow.appendChild(createStockNav("mdi-menu-left", -1, input, !hasNext));
  const pageInfo = document.createElement("span");
  pageInfo.className = "keyboard-input-stock-page";
  const from = inputStockOffset + 1;
  const to = Math.min(inputStockOffset + INPUT_STOCK_PAGE_SIZE, inputHistory.length);
  pageInfo.textContent = `${from}-${to} / ${inputHistory.length}`;
  navRow.appendChild(pageInfo);
  navRow.appendChild(createStockNav("mdi-menu-right", 1, input, !hasPrev));
  stock.appendChild(navRow);

  const visible = inputHistory.slice(inputStockOffset, inputStockOffset + INPUT_STOCK_PAGE_SIZE);
  for (const text of [...visible].reverse()) {
    stock.appendChild(createStockChip(text, input));
  }
}

function createStockChip(text, input) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "keyboard-input-stock-chip";
  chip.textContent = text;
  chip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    input.value = text;
    input.dispatchEvent(new Event("input"));
    input.focus({ preventScroll: true });
  });
  return chip;
}

function createStockNav(label, direction, input, disabled) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "keyboard-input-stock-nav";
  btn.innerHTML = `<i class="mdi ${label}"></i>`;
  btn.disabled = disabled;
  btn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    inputStockOffset += direction * INPUT_STOCK_PAGE_SIZE;
    inputStockOffset = Math.max(0, Math.min(inputStockOffset, inputHistory.length - INPUT_STOCK_PAGE_SIZE));
    renderInputStock();
    input.focus({ preventScroll: true });
  });
  return btn;
}

function showKeyboardInput() {
  if (document.querySelector(".terminal-frame.view-mode")) return;
  let el = $("keyboard-input");
  if (!el) el = createKeyboardInput();
  el.value = "";
  el.dispatchEvent(new Event("input"));
  const wrapper = el.closest(".keyboard-input-wrapper");
  wrapper.style.display = "";
  wrapper.style.top = "";
  inputStockOffset = 0;
  renderInputStock();
  const vv = window.visualViewport;
  if (vv) {
    const bottomOffset = window.innerHeight - (vv.offsetTop + vv.height);
    wrapper.style.bottom = (bottomOffset + 8) + "px";
  }
  el.focus({ preventScroll: true });
}

function repositionKeyboardInput(keyboardOpen) {
  const el = $("keyboard-input");
  if (!el) return;
  const wrapper = el.closest(".keyboard-input-wrapper");
  if (!wrapper || wrapper.style.display === "none") return;
  if (keyboardOpen) {
    const vv = window.visualViewport;
    if (vv) {
      const bottomOffset = window.innerHeight - (vv.offsetTop + vv.height);
      wrapper.style.bottom = (bottomOffset + 8) + "px";
    }
  } else {
    wrapper.style.display = "none";
  }
}

window.addEventListener("beforeunload", () => { isPageUnloading = true; });

document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  if (e.target.closest(".modal-overlay")) return;
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
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) closeSettings();
  });
applyPanelBottom();
  $("clone-cancel").addEventListener("click", closeCloneModal);
  $("clone-submit").addEventListener("click", submitClone);
  for (const tab of document.querySelectorAll(".clone-tab")) {
    tab.addEventListener("click", () => switchCloneTab(tab.dataset.tab));
  }
  $("branch-modal-close").addEventListener("click", closeBranchModal);
  $("diff-close").addEventListener("click", closeDiffModal);
  $("diff-commit-cancel").addEventListener("click", closeCommitForm);
  $("diff-commit-submit").addEventListener("click", submitCommit);
  $("item-create-cancel").addEventListener("click", closeItemCreateModal);
  $("item-create-submit").addEventListener("click", submitItemCreate);
  for (const radio of document.querySelectorAll('input[name="item-create-type"]')) {
    radio.addEventListener("change", () => switchItemCreateType(radio.value));
  }
  $("icon-picker-close").addEventListener("click", closeIconPicker);
  $("icon-picker-clear").addEventListener("click", clearIconPicker);
  $("icon-picker-modal").addEventListener("click", (e) => {
    if (e.target === $("icon-picker-modal")) closeIconPicker();
  });
  $("icon-picker-url-ok").addEventListener("click", submitIconPicker);
  for (const key of Object.keys(ICON_COLOR_FIELDS)) {
    setupIconPickerBtn(key);
  }
  $("git-log-branch-btn").addEventListener("click", openLocalBranchModal);
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
