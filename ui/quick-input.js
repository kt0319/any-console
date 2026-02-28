function initQuickInput() {
  const panel = $("quick-input-panel");

  const minimalArrow = document.createElement("div");
  minimalArrow.className = "quick-key quick-flick-arrow quick-key-toggle";
  minimalArrow.innerHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-keyboard"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';
  const FLICK_THRESHOLD = 40;
  const resolveArrowKey = (dx, dy, threshold) => {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold)
      return dx < 0
        ? { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }
        : { key: "ArrowRight", code: "ArrowRight", keyCode: 39 };
    if (Math.abs(dy) > threshold && dy < 0)
      return { key: "ArrowUp", code: "ArrowUp", keyCode: 38 };
    if (Math.abs(dy) > threshold && dy > 0)
      return { key: "ArrowDown", code: "ArrowDown", keyCode: 40 };
    return null;
  };
  let snippetModeActive = false;

  setupFlickRepeat(minimalArrow, resolveArrowKey, () => {
    if (keyboardPanelMode === 1) { cycleMode(); return; }
    if (snippetModeActive) { closeSnippetMode(); fileInput.click(); return; }
    const tab = openTabs.find(t => t.id === activeTabId);
    if (tab && tab.type === "terminal" && tab.term) {
      tab.term.scrollToBottom();
      safeFit(tab);
    }
  }, {
    accelerateRepeat: true,
    onLongPress: () => cycleMode(),
    longPressGuard: () => keyboardPanelMode === 0,
    onFlick: () => snippetModeActive,
  });
  const hardReloadBtn = document.createElement("div");
  hardReloadBtn.className = "quick-key quick-hard-reload";
  hardReloadBtn.innerHTML = '<span class="mdi mdi-refresh"></span>';
  hardReloadBtn.style.display = "none";
  hardReloadBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  hardReloadBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    window.location.href = window.location.pathname + "?_=" + Date.now();
  });
  hardReloadBtn.addEventListener("click", () => {
    window.location.href = window.location.pathname + "?_=" + Date.now();
  });

  const clearLocalStorageBtn = document.createElement("div");
  clearLocalStorageBtn.className = "quick-key quick-local-storage-clear";
  clearLocalStorageBtn.innerHTML = '<span class="mdi mdi-trash-can-outline"></span>';
  clearLocalStorageBtn.style.display = "none";
  clearLocalStorageBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  const clearPiConsoleStorage = () => {
    const ok = window.confirm("pi_console のローカルデータを削除します。続行しますか？");
    if (!ok) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("pi_console_")) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    sessionStorage.removeItem("pi_console_server_reloaded");
    window.location.href = window.location.pathname + "?_=" + Date.now();
  };
  clearLocalStorageBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    clearPiConsoleStorage();
  });
  clearLocalStorageBtn.addEventListener("click", clearPiConsoleStorage);

  const workspaceModalBtn = document.createElement("div");
  workspaceModalBtn.className = "quick-key quick-workspace-modal-open";
  workspaceModalBtn.innerHTML = '<span class="mdi mdi-view-grid-plus-outline"></span>';
  workspaceModalBtn.style.display = "none";
  const animateElements = (elements) => {
    for (const el of elements) {
      if (!el || el.offsetParent === null) continue;
      el.classList.remove("tap-bounce");
      void el.offsetWidth;
      el.classList.add("tap-bounce");
    }
  };
  const collectVisibleModeElements = () => [
      ...panel.querySelectorAll(".quick-key"),
      ...qwertyPanel.querySelectorAll(".quick-key"),
      ...snippetRow.querySelectorAll(".quick-key"),
      ...snippetRow.querySelectorAll(".quick-snippet-item"),
    ];
  const animateVisibleModeElements = () => {
    animateElements(collectVisibleModeElements());
  };
  const scheduleAnimateVisibleModeElements = () => {
    requestAnimationFrame(() => {
      animateVisibleModeElements();
    });
  };
  const openWorkspaceModal = () => {
    closeSnippetMode();
    if (typeof openTabEditModal === "function") openTabEditModal("open");
  };
  workspaceModalBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  workspaceModalBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    openWorkspaceModal();
  });
  workspaceModalBtn.addEventListener("click", openWorkspaceModal);

  const snippetExtras = [workspaceModalBtn, clearLocalStorageBtn, hardReloadBtn];
  const qwertyShiftBtn = document.createElement("div");
  qwertyShiftBtn.className = "quick-key quick-flick-arrow quick-modifier";
  qwertyShiftBtn.innerHTML = '<span class="flick-hint-top">Esc</span><span class="flick-hint-left">^U</span><span class="flick-main">\u21E7</span><span class="flick-hint-right">^K</span>';
  {
    let sx = 0, sy = 0;
    qwertyShiftBtn.addEventListener("touchstart", (e) => {
      e.preventDefault(); sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      qwertyShiftBtn.classList.add("pressed");
    }, { passive: false });
    qwertyShiftBtn.addEventListener("touchend", (e) => {
      e.preventDefault(); qwertyShiftBtn.classList.remove("pressed");
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dy) > Math.abs(dx) && dy < -FLICK_THRESHOLD) {
        sendKeyToTerminal({ key: "Escape", code: "Escape", keyCode: 27 });
      } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > FLICK_THRESHOLD) {
        sendKeyToTerminal(dx < 0 ? { key: "u", ctrl: true } : { key: "k", ctrl: true });
      } else {
        modifierState.shift = !modifierState.shift;
        qwertyShiftBtn.classList.toggle("active", modifierState.shift);
        if (onModifierToggled) onModifierToggled();
      }
    });
    qwertyShiftBtn.addEventListener("touchcancel", () => qwertyShiftBtn.classList.remove("pressed"));
    qwertyShiftBtn.addEventListener("click", () => {
      modifierState.shift = !modifierState.shift;
      qwertyShiftBtn.classList.toggle("active", modifierState.shift);
      if (onModifierToggled) onModifierToggled();
    });
  }

  const qwertyCtrlBtn = document.createElement("div");
  qwertyCtrlBtn.className = "quick-key quick-flick-arrow quick-modifier";
  qwertyCtrlBtn.innerHTML = '<span class="flick-hint-top">^C</span><span class="flick-hint-left">^L</span><span class="flick-main">\u2303</span><span class="flick-hint-right">^R</span><span class="flick-hint-bottom">^O</span>';
  {
    let sx = 0, sy = 0;
    qwertyCtrlBtn.addEventListener("touchstart", (e) => {
      e.preventDefault(); sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      qwertyCtrlBtn.classList.add("pressed");
    }, { passive: false });
    qwertyCtrlBtn.addEventListener("touchend", (e) => {
      e.preventDefault(); qwertyCtrlBtn.classList.remove("pressed");
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dy) > Math.abs(dx) && dy < -FLICK_THRESHOLD) {
        sendKeyToTerminal({ key: "c", ctrl: true });
      } else if (Math.abs(dy) > Math.abs(dx) && dy > FLICK_THRESHOLD) {
        sendKeyToTerminal({ key: "o", ctrl: true });
      } else if (Math.abs(dx) > Math.abs(dy) && dx < -FLICK_THRESHOLD) {
        sendKeyToTerminal({ key: "l", ctrl: true });
      } else if (Math.abs(dx) > Math.abs(dy) && dx > FLICK_THRESHOLD) {
        sendKeyToTerminal({ key: "r", ctrl: true });
      } else {
        modifierState.ctrl = !modifierState.ctrl;
        qwertyCtrlBtn.classList.toggle("active", modifierState.ctrl);
      }
    });
    qwertyCtrlBtn.addEventListener("touchcancel", () => qwertyCtrlBtn.classList.remove("pressed"));
    qwertyCtrlBtn.addEventListener("click", () => {
      modifierState.ctrl = !modifierState.ctrl;
      qwertyCtrlBtn.classList.toggle("active", modifierState.ctrl);
    });
  }

  const qwertySpaceBtn = document.createElement("div");
  qwertySpaceBtn.className = "quick-key quick-flick-arrow";
  qwertySpaceBtn.innerHTML = '<span class="flick-hint-top">PgU</span><span class="flick-hint-left">Home</span><span class="flick-main">\u2423</span><span class="flick-hint-right">End</span><span class="flick-hint-bottom">PgD</span>';
  {
    let sx = 0, sy = 0;
    qwertySpaceBtn.addEventListener("touchstart", (e) => {
      e.preventDefault(); sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      qwertySpaceBtn.classList.add("pressed");
    }, { passive: false });
    qwertySpaceBtn.addEventListener("touchend", (e) => {
      e.preventDefault(); qwertySpaceBtn.classList.remove("pressed");
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > FLICK_THRESHOLD) {
        sendKeyToTerminal(dx < 0
          ? { key: "Home", code: "Home", keyCode: 36 }
          : { key: "End", code: "End", keyCode: 35 });
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > FLICK_THRESHOLD) {
        sendKeyToTerminal(dy < 0
          ? { key: "PageUp", code: "PageUp", keyCode: 33 }
          : { key: "PageDown", code: "PageDown", keyCode: 34 });
      } else {
        sendKeyToTerminal({ key: " " });
      }
    });
    qwertySpaceBtn.addEventListener("touchcancel", () => qwertySpaceBtn.classList.remove("pressed"));
    qwertySpaceBtn.addEventListener("click", () => sendKeyToTerminal({ key: " " }));
  }

  const qwertyModKeys = [qwertyShiftBtn, qwertyCtrlBtn, qwertySpaceBtn];
  for (const el of qwertyModKeys) el.style.display = "none";
  const minimalKeyBtns = [workspaceModalBtn, clearLocalStorageBtn, hardReloadBtn, ...qwertyModKeys, minimalArrow];
  const quickKeyBtns = QUICK_KEYS.map(k => createQuickKeyBtn(k));
  const extraKeyBtns = EXTRA_MAIN_KEYS.map(k => {
    const btn = createQuickKeyBtn(k);
    btn.style.display = "none";
    return btn;
  });

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) uploadClipboardImage(file);
    fileInput.value = "";
  });
  panel.appendChild(fileInput);


  const minimalEnter = document.createElement("div");
  minimalEnter.className = "quick-key quick-flick-enter quick-flick-arrow quick-key-toggle";
  minimalEnter.innerHTML = '<span class="flick-hint-top">Tab</span><span class="flick-hint-left">BS</span><span class="flick-main">\u21B5</span><span class="flick-hint-bottom">Space</span><span class="flick-hint-right">Del</span>';
  const resolveEnterKey = (dx, dy, threshold) => {
    if (Math.abs(dy) > Math.abs(dx) && dy < -threshold)
      return { key: "Tab", code: "Tab", keyCode: 9 };
    if (Math.abs(dy) > Math.abs(dx) && dy > threshold)
      return { key: " ", code: "Space", keyCode: 32 };
    if (Math.abs(dx) > Math.abs(dy) && dx < -threshold)
      return { key: "Backspace", code: "Backspace", keyCode: 8 };
    if (Math.abs(dx) > Math.abs(dy) && dx > threshold)
      return { key: "Delete", code: "Delete", keyCode: 46 };
    return null;
  };
  setupFlickRepeat(minimalEnter, resolveEnterKey, () => {
    if (snippetRow.style.display === "flex") {
      closeSnippetMode();
    } else {
      exitViewModeIfActive();
      sendKeyToTerminal({ key: "Enter", code: "Enter", keyCode: 13 });
    }
  }, {
    accelerateRepeat: true,
    onLongPress: () => toggleSnippetRow(),
  });

  const bsKey = quickKeyBtns[0];
  const enterKey = quickKeyBtns[quickKeyBtns.length - 1];

  const flickNav = document.createElement("div");
  flickNav.className = "quick-key quick-flick-arrow";
  flickNav.innerHTML = '<span class="flick-hint-top"><span class="mdi mdi-chevron-double-up"></span></span><span class="flick-main"><span class="mdi mdi-chevron-double-down"></span></span>';
  let navStartY = 0;
  flickNav.addEventListener("touchstart", (e) => {
    e.preventDefault();
    navStartY = e.touches[0].clientY;
    flickNav.classList.add("pressed");
  }, { passive: false });
  flickNav.addEventListener("touchend", (e) => {
    e.preventDefault();
    flickNav.classList.remove("pressed");
    const dy = e.changedTouches[0].clientY - navStartY;
    if (Math.abs(dy) > FLICK_THRESHOLD && dy < 0) {
      scrollTerminal("up");
    } else {
      scrollTerminal("down");
    }
  });
  flickNav.addEventListener("touchcancel", () => flickNav.classList.remove("pressed"));


  for (const btn of minimalKeyBtns) panel.appendChild(btn);
  panel.appendChild(minimalEnter);


  const extraPanel = document.createElement("div");
  extraPanel.className = "quick-extra-panel";
  extraPanel.style.display = "none";

  const qwertyPanel = document.createElement("div");
  qwertyPanel.className = "quick-extra-panel quick-qwerty-panel";
  qwertyPanel.style.display = "none";
  const qwertyKeyBtns = [];
  for (let i = 0; i < QWERTY_ROWS.length; i++) {
    const row = document.createElement("div");
    row.className = "quick-extra-row";
    for (let j = 0; j < QWERTY_ROWS[i].length; j++) {
      const keyDef = QWERTY_ROWS[i][j];
      const btn = createQuickKeyBtn(keyDef);
      const hasFlickUp = (i === 0 && j < NUMBER_KEYS.length) || keyDef.flickUp;
      const hasFlickDown = !!keyDef.flickDown;
      if (hasFlickUp || hasFlickDown) {
        btn.classList.add("quick-flick-arrow");
        const mainText = btn.textContent;
        btn.textContent = "";
        if (hasFlickUp) {
          const hintTop = document.createElement("span");
          hintTop.className = "flick-hint-top";
          if (i === 0) {
            btn._flickUpKeyDef = NUMBER_KEYS[j];
            hintTop.textContent = NUMBER_KEYS[j].label;
          } else {
            btn._flickUpKeyDef = { label: keyDef.flickUp, key: keyDef.flickUp };
            hintTop.textContent = keyDef.flickUp;
          }
          btn.appendChild(hintTop);
        }
        const main = document.createElement("span");
        main.className = "flick-main";
        main.textContent = mainText;
        btn.appendChild(main);
        if (hasFlickDown) {
          btn._flickDownKeyDef = { label: keyDef.flickDown, key: keyDef.flickDown };
          const hintBottom = document.createElement("span");
          hintBottom.className = "flick-hint-bottom";
          hintBottom.textContent = keyDef.flickDown;
          btn.appendChild(hintBottom);
        }
      }
      row.appendChild(btn);
      qwertyKeyBtns.push({ btn, row: i, col: j });
    }
    qwertyPanel.appendChild(row);
  }
  const updateQwertyKeys = () => {
    for (const { btn, row, col } of qwertyKeyBtns) {
      const base = QWERTY_ROWS[row][col];
      const keyDef = modifierState.shift
        ? { ...base, label: base.key.toUpperCase() }
        : base;
      btn._keyDef = keyDef;
      const flickMain = btn.querySelector(".flick-main");
      if (flickMain) flickMain.textContent = keyDef.label;
      else btn.textContent = keyDef.label;
    }
  };
  onModifiersCleared = updateQwertyKeys;
  onModifierToggled = updateQwertyKeys;
  const enterBtn = createQuickKeyBtn({ label: "\u21B5", key: "Enter" });
  const snippetRow = document.createElement("div");
  snippetRow.className = "quick-snippet-row";

  const updateEnterBtn = () => {
    const snippetVisible = snippetRow.style.display === "flex";
    if (snippetVisible) {
      enterBtn.innerHTML = '<span class="mdi mdi-close"></span>';
      enterBtn._overrideAction = () => { snippetRow.style.display = "none"; updateEnterBtn(); };
    } else {
      enterBtn._overrideAction = null;
      enterBtn._keyDef = { label: "\u21B5", key: "Enter" };
      enterBtn.textContent = "\u21B5";
    }
  };

  function closeSnippetMode() {
    snippetModeActive = false;
    snippetRow.style.display = "none";
    for (const el of snippetExtras) el.style.display = "none";
    panel.classList.remove("snippet-open");
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    minimalArrow.innerHTML = minimalArrowDefaultHTML;
    updateEnterBtn();
    scheduleAnimateVisibleModeElements();
  }

  const renderQuickSnippets = () => renderSnippetRow(snippetRow, (text) => {
    sendTextToTerminal(text);
    closeSnippetMode();
  }).then(() => {
    scheduleAnimateVisibleModeElements();
  });

  snippetRow.style.display = "none";

  let keyboardPanelMode = 0;

  const cycleMode = () => {
    keyboardPanelMode = (keyboardPanelMode + 1) % 2;
    clearModifiers();
    snippetModeActive = false;
    snippetRow.style.display = "none";
    for (const el of snippetExtras) el.style.display = "none";
    panel.classList.remove("snippet-open");
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    updateEnterBtn();
    applyMode(true);
  };

  const minimalEnterDefaultHTML = '<span class="flick-hint-top">Tab</span><span class="flick-hint-left">BS</span><span class="flick-main">\u21B5</span><span class="flick-hint-bottom">Space</span><span class="flick-hint-right">Del</span>';

  const toggleSnippetRow = () => {
    const visible = snippetRow.style.display === "flex";
    if (visible) {
      snippetModeActive = false;
      snippetRow.style.display = "none";
      for (const el of snippetExtras) el.style.display = "none";
      panel.classList.remove("snippet-open");
      minimalEnter.innerHTML = minimalEnterDefaultHTML;
      minimalEnter.classList.remove("active");
      minimalArrow.innerHTML = minimalArrowDefaultHTML;
      scheduleAnimateVisibleModeElements();
    } else {
      if (keyboardPanelMode !== 0) {
        keyboardPanelMode = 0;
        clearModifiers();
        applyMode();
      }
      snippetModeActive = true;
      snippetRow.style.display = "flex";
      for (const el of snippetExtras) el.style.display = "";
      panel.classList.add("snippet-open");
      renderQuickSnippets();
      minimalEnter.innerHTML = '<span class="mdi mdi-close"></span>';
      minimalEnter.classList.add("active");
      minimalArrow.innerHTML = '<span class="flick-main"><span class="mdi mdi-camera"></span></span>';
      scheduleAnimateVisibleModeElements();
    }
    updateEnterBtn();
  };

  const minimalArrowDefaultHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-keyboard"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';

  const applyMode = (animate = false) => {
    panel.classList.toggle("minimal-mode", keyboardPanelMode === 0);
    panel.classList.toggle("extra-open", keyboardPanelMode === 1);
    minimalArrow.classList.toggle("active", keyboardPanelMode === 1);
    if (keyboardPanelMode === 1) {
      minimalArrow.innerHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-close"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';
    } else {
      minimalArrow.innerHTML = minimalArrowDefaultHTML;
    }
    for (const el of qwertyModKeys) el.style.display = keyboardPanelMode === 1 ? "" : "none";
    extraPanel.style.display = "none";
    qwertyPanel.style.display = keyboardPanelMode === 1 ? "flex" : "none";
    if (animate) scheduleAnimateVisibleModeElements();
  };
  applyMode();

  const closeExtraOnOutside = (e) => {
    if (panel.contains(e.target) || qwertyPanel.contains(e.target) || snippetRow.contains(e.target)) return;
    if (keyboardPanelMode !== 0) {
      keyboardPanelMode = 0;
      applyMode();
    }
    snippetModeActive = false;
    snippetRow.style.display = "none";
    for (const el of snippetExtras) el.style.display = "none";
    panel.classList.remove("snippet-open");
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    minimalArrow.innerHTML = minimalArrowDefaultHTML;
    updateEnterBtn();
  };
  document.addEventListener("touchend", closeExtraOnOutside);
  document.addEventListener("click", closeExtraOnOutside);

  const minimalSnippetWrap = document.createElement("div");
  minimalSnippetWrap.className = "quick-minimal-snippet-wrap";
  minimalSnippetWrap.appendChild(snippetRow);

  const parentEl = panel.parentNode;
  parentEl.insertBefore(extraPanel, panel);
  parentEl.insertBefore(qwertyPanel, panel);
  parentEl.insertBefore(minimalSnippetWrap, panel);
}
