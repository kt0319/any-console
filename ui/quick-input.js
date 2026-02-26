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
  setupFlickRepeat(minimalArrow, resolveArrowKey, () => {
    if (keyboardPanelMode === 1) { cycleMode(); return; }
    const tab = openTabs.find(t => t.id === activeTabId);
    if (tab && tab.type === "terminal" && tab.term) {
      tab.term.scrollToBottom();
      safeFit(tab);
    }
  }, {
    onLongPress: () => cycleMode(),
    longPressGuard: () => keyboardPanelMode === 0,
  });
  const minimalKeyBtns = [minimalArrow];
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

  const menuBtn = document.createElement("div");
  menuBtn.className = "quick-key quick-flick-arrow";
  menuBtn.innerHTML = '<span class="flick-hint-top"><span class="mdi mdi-plus-circle-outline"></span></span><span class="flick-main"><span class="mdi mdi-camera" style="font-size:14px"></span></span>';
  let menuStartX = 0, menuStartY = 0;
  menuBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    menuStartX = e.touches[0].clientX;
    menuStartY = e.touches[0].clientY;
    menuBtn.classList.add("pressed");
  }, { passive: false });
  menuBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    menuBtn.classList.remove("pressed");
    const dy = e.changedTouches[0].clientY - menuStartY;
    if (Math.abs(dy) > FLICK_THRESHOLD && dy < 0) {
      const cmd = prompt("スニペットを入力:");
      if (cmd) {
        addSnippet(cmd);
        snippetRow.style.display = "flex";
        renderQuickSnippets();
        updateEnterBtn();
      }
    } else {
      fileInput.click();
    }
  });
  menuBtn.addEventListener("touchcancel", () => menuBtn.classList.remove("pressed"));
  menuBtn.addEventListener("click", () => fileInput.click());

  const mode1Shift = document.createElement("div");
  mode1Shift.className = "quick-key quick-flick-arrow quick-modifier";
  mode1Shift.innerHTML = '<span class="flick-hint-top">Esc</span><span class="flick-hint-left">^U</span><span class="flick-main">\u21E7</span><span class="flick-hint-right">^K</span>';
  let shiftStartX = 0, shiftStartY = 0;
  mode1Shift.addEventListener("touchstart", (e) => {
    e.preventDefault();
    shiftStartX = e.touches[0].clientX;
    shiftStartY = e.touches[0].clientY;
    mode1Shift.classList.add("pressed");
  }, { passive: false });
  mode1Shift.addEventListener("touchend", (e) => {
    e.preventDefault();
    mode1Shift.classList.remove("pressed");
    const dx = e.changedTouches[0].clientX - shiftStartX;
    const dy = e.changedTouches[0].clientY - shiftStartY;
    if (Math.abs(dy) > Math.abs(dx) && dy < -FLICK_THRESHOLD) {
      sendKeyToTerminal({ key: "Escape", code: "Escape", keyCode: 27 });
    } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > FLICK_THRESHOLD) {
      sendKeyToTerminal(dx < 0
        ? { key: "u", ctrl: true }
        : { key: "k", ctrl: true });
    } else {
      modifierState.shift = !modifierState.shift;
      mode1Shift.classList.toggle("active", modifierState.shift);
      if (onModifierToggled) onModifierToggled();
    }
  });
  mode1Shift.addEventListener("touchcancel", () => mode1Shift.classList.remove("pressed"));
  mode1Shift.addEventListener("click", () => {
    modifierState.shift = !modifierState.shift;
    mode1Shift.classList.toggle("active", modifierState.shift);
    if (onModifierToggled) onModifierToggled();
  });

  const flickControlKey = document.createElement("div");
  flickControlKey.className = "quick-key quick-flick-arrow quick-modifier";
  flickControlKey.innerHTML = '<span class="flick-hint-top">^C</span><span class="flick-hint-left">^L</span><span class="flick-main">\u2303</span><span class="flick-hint-right">^R</span><span class="flick-hint-bottom">^O</span>';
  let ctrlStartX = 0, ctrlStartY = 0;
  flickControlKey.addEventListener("touchstart", (e) => {
    e.preventDefault();
    ctrlStartX = e.touches[0].clientX;
    ctrlStartY = e.touches[0].clientY;
    flickControlKey.classList.add("pressed");
  }, { passive: false });
  flickControlKey.addEventListener("touchend", (e) => {
    e.preventDefault();
    flickControlKey.classList.remove("pressed");
    const dx = e.changedTouches[0].clientX - ctrlStartX;
    const dy = e.changedTouches[0].clientY - ctrlStartY;
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
      flickControlKey.classList.toggle("active", modifierState.ctrl);
    }
  });
  flickControlKey.addEventListener("touchcancel", () => flickControlKey.classList.remove("pressed"));
  flickControlKey.addEventListener("click", () => {
    modifierState.ctrl = !modifierState.ctrl;
    flickControlKey.classList.toggle("active", modifierState.ctrl);
  });

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


  const createFlickTab = (opts = {}) => {
    const leftLabel = opts.leftLabel || "Home";
    const leftKey = opts.leftKey || { key: "Home", code: "Home", keyCode: 36 };
    const el = document.createElement("div");
    el.className = "quick-key quick-flick-arrow";
    el.innerHTML = `<span class="flick-hint-top">PgU</span><span class="flick-hint-left">${leftLabel}</span><span class="flick-main">\u2423</span><span class="flick-hint-right">End</span><span class="flick-hint-bottom">PgD</span>`;
    let startX = 0, startY = 0;
    el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      el.classList.add("pressed");
    }, { passive: false });
    el.addEventListener("touchend", (e) => {
      e.preventDefault();
      el.classList.remove("pressed");
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > FLICK_THRESHOLD) {
        sendKeyToTerminal(dx < 0
          ? leftKey
          : { key: "End", code: "End", keyCode: 35 });
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > FLICK_THRESHOLD) {
        sendKeyToTerminal(dy < 0
          ? { key: "PageUp", code: "PageUp", keyCode: 33 }
          : { key: "PageDown", code: "PageDown", keyCode: 34 });
      } else {
        sendKeyToTerminal({ key: " " });
      }
    });
    el.addEventListener("touchcancel", () => el.classList.remove("pressed"));
    el.addEventListener("click", () => {
      sendKeyToTerminal({ key: " " });
    });
    return el;
  };
  const flickTab = createFlickTab();
  const mode1Elements = [menuBtn, mode1Shift, flickControlKey, flickTab];
  for (const el of mode1Elements) {
    el.style.display = "none";
    panel.appendChild(el);
  }
  for (const btn of minimalKeyBtns) panel.appendChild(btn);
  panel.appendChild(minimalEnter);


  const extraPanel = document.createElement("div");
  extraPanel.className = "quick-extra-panel";
  extraPanel.style.display = "none";

  const qwertyPanel = document.createElement("div");
  qwertyPanel.className = "quick-extra-panel quick-qwerty-panel";
  qwertyPanel.style.display = "none";
  let isQwertyFnActive = false;
  const qwertyKeyBtns = [];
  for (let i = 0; i < QWERTY_ROWS.length; i++) {
    const row = document.createElement("div");
    row.className = "quick-extra-row";
    for (let j = 0; j < QWERTY_ROWS[i].length; j++) {
      const btn = createQuickKeyBtn(QWERTY_ROWS[i][j]);
      if (i === 0 && j < NUMBER_KEYS.length) {
        btn._flickUpKeyDef = NUMBER_KEYS[j];
        btn.classList.add("quick-flick-arrow");
        const mainText = btn.textContent;
        btn.textContent = "";
        const hintTop = document.createElement("span");
        hintTop.className = "flick-hint-top";
        hintTop.textContent = NUMBER_KEYS[j].label;
        const main = document.createElement("span");
        main.className = "flick-main";
        main.textContent = mainText;
        btn.appendChild(hintTop);
        btn.appendChild(main);
      }
      row.appendChild(btn);
      qwertyKeyBtns.push({ btn, row: i, col: j });
    }
    qwertyPanel.appendChild(row);
  }
  const bottomDynBtns = [];
  const FN_FLICK_UP = { "(": "<", ")": ">", "[": "{", "]": "}", "/": "\\", "-": "9", ":": ";", ",": "`" };
  const updateQwertyKeys = () => {
    for (const { btn, row, col } of qwertyKeyBtns) {
      let keyDef;
      if (isQwertyFnActive) {
        keyDef = FN_ROWS[row][col];
      } else if (modifierState.shift) {
        const base = QWERTY_ROWS[row][col];
        keyDef = { ...base, label: base.key.toUpperCase() };
      } else {
        keyDef = QWERTY_ROWS[row][col];
      }
      btn._keyDef = keyDef;
      const fnFlickChar = isQwertyFnActive ? FN_FLICK_UP[keyDef.key] : null;
      if (row === 0 && col < NUMBER_KEYS.length) {
        btn._flickUpKeyDef = fnFlickChar
          ? { label: fnFlickChar, key: fnFlickChar }
          : NUMBER_KEYS[col];
        const hintTop = btn.querySelector(".flick-hint-top");
        if (hintTop) hintTop.textContent = fnFlickChar || NUMBER_KEYS[col].label;
        const flickMain = btn.querySelector(".flick-main");
        if (flickMain) flickMain.textContent = keyDef.label;
        const hintBottom = btn.querySelector(".flick-hint-bottom");
        if (hintBottom) hintBottom.style.display = isQwertyFnActive ? "none" : "";
      } else {
        if (!fnFlickChar && btn._fnFlick) {
          btn._flickUpKeyDef = null;
          btn.classList.remove("quick-flick-arrow");
          btn.innerHTML = "";
          btn._fnFlick = false;
        }
        if (fnFlickChar) {
          btn._flickUpKeyDef = { label: fnFlickChar, key: fnFlickChar };
          if (!btn._fnFlick) {
            btn.classList.add("quick-flick-arrow");
            btn.textContent = "";
            const ht = document.createElement("span");
            ht.className = "flick-hint-top";
            const fm = document.createElement("span");
            fm.className = "flick-main";
            btn.appendChild(ht);
            btn.appendChild(fm);
            btn._fnFlick = true;
          }
          btn.querySelector(".flick-hint-top").textContent = fnFlickChar;
          btn.querySelector(".flick-main").textContent = keyDef.label;
        } else {
          const flickMain = btn.querySelector(".flick-main");
          if (flickMain) flickMain.textContent = keyDef.label;
          else btn.textContent = keyDef.label;
        }
      }
    }
    for (const { btn, normal, fn } of bottomDynBtns) {
      const keyDef = isQwertyFnActive ? fn : normal;
      btn._keyDef = keyDef;
      const flickMain = btn.querySelector(".flick-main");
      if (flickMain) flickMain.textContent = keyDef.label;
      else btn.textContent = keyDef.label;
    }
  };
  onModifiersCleared = updateQwertyKeys;
  onModifierToggled = updateQwertyKeys;
  const fnBtn = document.createElement("div");
  fnBtn.className = "quick-key quick-modifier";
  fnBtn.textContent = "Fn";
  const toggleFn = () => {
    isQwertyFnActive = !isQwertyFnActive;
    fnBtn.classList.toggle("active", isQwertyFnActive);
    updateQwertyKeys();
  };
  fnBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  fnBtn.addEventListener("touchend", (e) => { e.preventDefault(); toggleFn(); });
  fnBtn.addEventListener("click", toggleFn);
  const qwertyRow2 = qwertyPanel.querySelector(".quick-extra-row:nth-child(3)");
  if (qwertyRow2) {
    qwertyRow2.appendChild(fnBtn);
  }
  const qwertyBottomRow = document.createElement("div");
  qwertyBottomRow.className = "quick-extra-row";
  const qwertyBottomDynDefs = [
    { normal: { label: "\u2423", key: " " }, fn: { label: "}", key: "}" } },
  ];
  qwertyBottomRow.appendChild(createModifierBtn("ctrl", "\u2303"));
  for (const def of qwertyBottomDynDefs) {
    const btn = createQuickKeyBtn(def.normal);
    if (def.normal.key === " ") {
      btn._flickUpKeyDef = { label: "-", key: "-" };
      btn._flickDownKeyDef = { label: "_", key: "_" };
      btn.classList.add("quick-flick-arrow");
      btn.textContent = "";
      const hintTop = document.createElement("span");
      hintTop.className = "flick-hint-top";
      hintTop.textContent = "-";
      const main = document.createElement("span");
      main.className = "flick-main";
      main.textContent = "\u2423";
      const hintBottom = document.createElement("span");
      hintBottom.className = "flick-hint-bottom";
      hintBottom.textContent = "_";
      btn.appendChild(hintTop);
      btn.appendChild(main);
      btn.appendChild(hintBottom);
    }
    qwertyBottomRow.appendChild(btn);
    bottomDynBtns.push({ btn, normal: def.normal, fn: def.fn });
  }
  const qwertyFlickBs = document.createElement("div");
  qwertyFlickBs.className = "quick-key quick-flick-arrow";
  qwertyFlickBs.innerHTML = '<span class="flick-hint-top">Esc</span><span class="flick-hint-left">^U</span><span class="flick-main"><span class="mdi mdi-backspace-outline"></span></span><span class="flick-hint-right">^K</span>';
  let qBsStartX = 0, qBsStartY = 0;
  qwertyFlickBs.addEventListener("touchstart", (e) => {
    e.preventDefault();
    qBsStartX = e.touches[0].clientX;
    qBsStartY = e.touches[0].clientY;
    qwertyFlickBs.classList.add("pressed");
  }, { passive: false });
  qwertyFlickBs.addEventListener("touchend", (e) => {
    e.preventDefault();
    qwertyFlickBs.classList.remove("pressed");
    const dx = e.changedTouches[0].clientX - qBsStartX;
    const dy = e.changedTouches[0].clientY - qBsStartY;
    if (Math.abs(dy) > Math.abs(dx) && dy < -FLICK_THRESHOLD) {
      sendKeyToTerminal({ key: "Escape", code: "Escape", keyCode: 27 });
    } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > FLICK_THRESHOLD) {
      sendKeyToTerminal(dx < 0
        ? { key: "u", ctrl: true }
        : { key: "k", ctrl: true });
    } else {
      sendKeyToTerminal({ key: "Backspace", code: "Backspace", keyCode: 8 });
    }
  });
  qwertyFlickBs.addEventListener("touchcancel", () => qwertyFlickBs.classList.remove("pressed"));
  qwertyFlickBs.addEventListener("click", () => {
    sendKeyToTerminal({ key: "Backspace", code: "Backspace", keyCode: 8 });
  });
  qwertyBottomRow.appendChild(qwertyFlickBs);
  const qwertyFlickTab = createFlickTab();
  qwertyBottomRow.appendChild(qwertyFlickTab);
  const qwertyToggle = document.createElement("div");
  qwertyToggle.className = "quick-key quick-key-toggle";
  qwertyToggle.innerHTML = '<span class="mdi mdi-close"></span>';
  qwertyToggle.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  qwertyToggle.addEventListener("touchend", (e) => { e.preventDefault(); cycleMode(); });
  qwertyToggle.addEventListener("click", () => cycleMode());
  qwertyBottomRow.appendChild(qwertyToggle);
  const enterBtn = createQuickKeyBtn({ label: "\u21B5", key: "Enter" });
  qwertyBottomRow.appendChild(enterBtn);
  bottomDynBtns.push({ btn: enterBtn, normal: { label: "\u21B5", key: "Enter" }, fn: { label: "Esc", key: "Escape" } });
  const snippetRow = document.createElement("div");
  snippetRow.className = "quick-snippet-row";

  const updateEnterBtn = () => {
    const snippetVisible = snippetRow.style.display === "flex";
    if (snippetVisible) {
      enterBtn.innerHTML = '<span class="mdi mdi-close"></span>';
      enterBtn._overrideAction = () => { snippetRow.style.display = "none"; updateEnterBtn(); };
    } else {
      enterBtn._overrideAction = null;
      const dynEntry = bottomDynBtns.find((d) => d.btn === enterBtn);
      const def = isQwertyFnActive ? dynEntry.fn : dynEntry.normal;
      enterBtn._keyDef = def;
      if (def.html) enterBtn.innerHTML = def.html;
      else enterBtn.textContent = def.label;
    }
  };

  function closeSnippetMode() {
    snippetRow.style.display = "none";
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    updateEnterBtn();
  }

  const renderQuickSnippets = () => renderSnippetRow(snippetRow, (text) => {
    sendTextToTerminal(text);
    closeSnippetMode();
  });

  snippetRow.style.display = "none";

  let keyboardPanelMode = 0;

  const cycleMode = () => {
    keyboardPanelMode = (keyboardPanelMode + 1) % 2;
    isQwertyFnActive = false;
    fnBtn.classList.remove("active");
    clearModifiers();
    snippetRow.style.display = "none";
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    updateEnterBtn();
    applyMode();
  };

  const minimalEnterDefaultHTML = '<span class="flick-hint-top">Tab</span><span class="flick-hint-left">BS</span><span class="flick-main">\u21B5</span><span class="flick-hint-bottom">Space</span><span class="flick-hint-right">Del</span>';

  const toggleSnippetRow = () => {
    const visible = snippetRow.style.display === "flex";
    if (visible) {
      snippetRow.style.display = "none";
      minimalEnter.innerHTML = minimalEnterDefaultHTML;
      minimalEnter.classList.remove("active");
    } else {
      if (keyboardPanelMode !== 0) {
        keyboardPanelMode = 0;
        clearModifiers();
        applyMode();
      }
      snippetRow.style.display = "flex";
      renderQuickSnippets();
      minimalEnter.innerHTML = '<span class="mdi mdi-close"></span>';
      minimalEnter.classList.add("active");
    }
    updateEnterBtn();
  };

  const minimalArrowDefaultHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-keyboard"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';

  const applyMode = () => {
    panel.classList.toggle("minimal-mode", keyboardPanelMode === 0);
    panel.classList.toggle("extra-open", keyboardPanelMode === 1);
    minimalArrow.classList.toggle("active", keyboardPanelMode === 1);
    if (keyboardPanelMode === 1) {
      minimalArrow.innerHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-close"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';
    } else {
      minimalArrow.innerHTML = minimalArrowDefaultHTML;
    }
    for (const el of mode1Elements) el.style.display = keyboardPanelMode === 1 ? "" : "none";
    extraPanel.style.display = "none";
    qwertyPanel.style.display = keyboardPanelMode === 1 ? "flex" : "none";
  };
  applyMode();

  const closeExtraOnOutside = (e) => {
    if (panel.contains(e.target) || qwertyPanel.contains(e.target) || snippetRow.contains(e.target)) return;
    if (keyboardPanelMode !== 0) {
      keyboardPanelMode = 0;
      applyMode();
    }
    snippetRow.style.display = "none";
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    updateEnterBtn();
  };
  document.addEventListener("touchend", closeExtraOnOutside);
  document.addEventListener("click", closeExtraOnOutside);

  const parentEl = panel.parentNode;
  parentEl.insertBefore(extraPanel, panel);
  parentEl.insertBefore(qwertyPanel, panel);
  parentEl.insertBefore(snippetRow, panel);
}
