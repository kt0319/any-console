function getActiveTerminalTab() {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab || tab.type !== "terminal") return null;
  return tab;
}

function sendKeyToTerminal(keyDef) {
  const tab = getActiveTerminalTab();
  console.log("[quickkey]", keyDef.key, "tab=", !!tab, "ws=", tab?.ws?.readyState);
  if (!tab || !tab.ws || tab.ws.readyState !== WebSocket.OPEN) return;
  const seq = keyDefToAnsi(keyDef);
  console.log("[quickkey] seq=", seq ? seq.length + "chars" : "null");
  if (seq) tab.ws.send(new TextEncoder().encode(seq));
}

function keyDefToAnsi(keyDef) {
  if (keyDef.ctrl && keyDef.key.length === 1) {
    const code = keyDef.key.toLowerCase().charCodeAt(0) - 96;
    if (code > 0 && code < 27) return String.fromCharCode(code);
  }
  if (keyDef.shift && keyDef.key === "Tab") return "\x1b[Z";
  if (keyDef.shift && keyDef.key.length === 1) return keyDef.key.toUpperCase();
  const mapping = {
    Backspace: "\x7f",
    Enter: "\r",
    Tab: "\t",
    Escape: "\x1b",
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Home: "\x1b[H",
    End: "\x1b[F",
    Delete: "\x1b[3~",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
    " ": " ",
    "/": "/",
  };
  if (mapping[keyDef.key]) return mapping[keyDef.key];
  if (keyDef.key.length === 1) return keyDef.key;
  return null;
}

function sendTextToTerminal(text) {
  const tab = getActiveTerminalTab();
  if (!tab || !tab.ws || tab.ws.readyState !== WebSocket.OPEN) return;
  tab.ws.send(new TextEncoder().encode(text));
}

function scrollTerminal(direction) {
  const tab = getActiveTerminalTab();
  if (!tab || !tab.term) return;
  tab.term.scrollLines(direction === "up" ? -20 : 20);
}

async function uploadClipboardImage(file) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return;

  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/upload-image", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.path) sendTextToTerminal(data.path);
  } catch {}
}

const modifierState = { ctrl: false, shift: false };

function createModifierBtn(mod, label, onChange) {
  const btn = document.createElement("div");
  btn.className = "quick-key quick-modifier";
  btn.textContent = label;
  const toggle = () => {
    modifierState[mod] = !modifierState[mod];
    btn.classList.toggle("active", modifierState[mod]);
    if (onChange) onChange();
  };
  btn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  btn.addEventListener("touchend", (e) => { e.preventDefault(); toggle(); });
  btn.addEventListener("click", toggle);
  return btn;
}

let onModifiersCleared = null;

function clearModifiers() {
  modifierState.ctrl = false;
  modifierState.shift = false;
  for (const el of document.querySelectorAll(".quick-modifier.active")) {
    el.classList.remove("active");
  }
  if (onModifiersCleared) onModifiersCleared();
}

function createQuickKeyBtn(keyDef) {
  const btn = document.createElement("div");
  btn.className = "quick-key";
  btn._keyDef = keyDef;
  if (keyDef.html) btn.innerHTML = keyDef.html;
  else btn.textContent = keyDef.label;
  const activate = () => {
    const kd = btn._keyDef;
    if (kd.xtermScroll) {
      scrollTerminal(kd.xtermScroll);
    } else {
      const merged = { ...kd };
      if (modifierState.ctrl) merged.ctrl = true;
      if (modifierState.shift) merged.shift = true;
      sendKeyToTerminal(merged);
      if (modifierState.ctrl || modifierState.shift) clearModifiers();
    }
  };
  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    btn.classList.add("pressed");
  }, { passive: false });
  btn.addEventListener("touchend", (e) => {
    e.preventDefault();
    btn.classList.remove("pressed");
    activate();
  });
  btn.addEventListener("touchcancel", () => btn.classList.remove("pressed"));
  btn.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    btn.classList.add("pressed");
  });
  btn.addEventListener("mouseup", (e) => {
    if (e.button !== 0) return;
    btn.classList.remove("pressed");
    activate();
  });
  btn.addEventListener("mouseleave", () => btn.classList.remove("pressed"));
  return btn;
}

function initQuickInput() {
  const panel = $("quick-input-panel");

  const toggleBtn = document.createElement("div");
  toggleBtn.className = "quick-key quick-key-toggle";
  toggleBtn.innerHTML = '<span class="mdi mdi-keyboard-outline"></span>';

  const minimalArrow = document.createElement("div");
  minimalArrow.className = "quick-key quick-flick-arrow";
  minimalArrow.innerHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-keyboard-outline"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';
  const FLICK_THRESHOLD = 40;
  let arrowStartX = 0, arrowStartY = 0;
  minimalArrow.addEventListener("touchstart", (e) => {
    e.preventDefault();
    arrowStartX = e.touches[0].clientX;
    arrowStartY = e.touches[0].clientY;
    minimalArrow.classList.add("pressed");
  }, { passive: false });
  minimalArrow.addEventListener("touchend", (e) => {
    e.preventDefault();
    minimalArrow.classList.remove("pressed");
    const dx = e.changedTouches[0].clientX - arrowStartX;
    const dy = e.changedTouches[0].clientY - arrowStartY;
    let key;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > FLICK_THRESHOLD) {
      key = dx < 0
        ? { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }
        : { key: "ArrowRight", code: "ArrowRight", keyCode: 39 };
    } else if (Math.abs(dy) > FLICK_THRESHOLD && dy < 0) {
      key = { key: "ArrowUp", code: "ArrowUp", keyCode: 38 };
    } else if (Math.abs(dy) > FLICK_THRESHOLD && dy > 0) {
      key = { key: "ArrowDown", code: "ArrowDown", keyCode: 40 };
    } else {
      cycleMode();
      return;
    }
    sendKeyToTerminal(key);
  });
  minimalArrow.addEventListener("touchcancel", () => minimalArrow.classList.remove("pressed"));
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

  const createCameraBtn = () => {
    const btn = document.createElement("div");
    btn.className = "quick-key";
    btn.innerHTML = '<span class="mdi mdi-camera"></span>';
    btn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    btn.addEventListener("touchend", (e) => { e.preventDefault(); fileInput.click(); });
    btn.addEventListener("click", () => fileInput.click());
    return btn;
  };
  const imgBtn = createCameraBtn();
  const menuBtn = createCameraBtn();

  const minimalEnter = document.createElement("div");
  minimalEnter.className = "quick-key quick-flick-enter";
  minimalEnter.innerHTML = '<span class="flick-hint-top">Del</span><span class="flick-hint-left">BS</span><span class="flick-main">\u21B5</span><span class="flick-hint-bottom">\u2423</span>';
  let flickStartX = 0, flickStartY = 0;
  minimalEnter.addEventListener("touchstart", (e) => {
    e.preventDefault();
    flickStartX = e.touches[0].clientX;
    flickStartY = e.touches[0].clientY;
    minimalEnter.classList.add("pressed");
  }, { passive: false });
  minimalEnter.addEventListener("touchend", (e) => {
    e.preventDefault();
    minimalEnter.classList.remove("pressed");
    const dx = e.changedTouches[0].clientX - flickStartX;
    const dy = e.changedTouches[0].clientY - flickStartY;
    if (Math.abs(dy) > Math.abs(dx) && dy < -FLICK_THRESHOLD) {
      sendKeyToTerminal({ key: "Delete", code: "Delete", keyCode: 46 });
    } else if (Math.abs(dy) > Math.abs(dx) && dy > FLICK_THRESHOLD) {
      sendKeyToTerminal({ key: " " });
    } else if (Math.abs(dx) > Math.abs(dy) && dx < -FLICK_THRESHOLD) {
      sendKeyToTerminal({ key: "Backspace", code: "Backspace", keyCode: 8 });
    } else {
      sendKeyToTerminal({ key: "Enter", code: "Enter", keyCode: 13 });
    }
  });
  minimalEnter.addEventListener("touchcancel", () => minimalEnter.classList.remove("pressed"));

  panel.appendChild(menuBtn);
  for (const btn of minimalKeyBtns) panel.appendChild(btn);
  panel.appendChild(minimalEnter);

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

  const escBtn = document.createElement("div");
  escBtn.className = "quick-key";
  escBtn.textContent = "Esc";
  escBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  escBtn.addEventListener("touchend", (e) => { e.preventDefault(); sendKeyToTerminal({ key: "Escape", code: "Escape", keyCode: 27 }); });
  escBtn.addEventListener("click", () => sendKeyToTerminal({ key: "Escape", code: "Escape", keyCode: 27 }));

  const flickKill = document.createElement("div");
  flickKill.className = "quick-key quick-flick-arrow";
  flickKill.innerHTML = '<span class="flick-hint-left">^U</span><span class="flick-main"><span class="mdi mdi-backspace-outline"></span></span><span class="flick-hint-right">^K</span>';
  let killStartX = 0;
  flickKill.addEventListener("touchstart", (e) => {
    e.preventDefault();
    killStartX = e.touches[0].clientX;
    flickKill.classList.add("pressed");
  }, { passive: false });
  flickKill.addEventListener("touchend", (e) => {
    e.preventDefault();
    flickKill.classList.remove("pressed");
    const dx = e.changedTouches[0].clientX - killStartX;
    if (Math.abs(dx) > FLICK_THRESHOLD) {
      sendKeyToTerminal(dx < 0
        ? { key: "u", ctrl: true }
        : { key: "k", ctrl: true });
    }
  });
  flickKill.addEventListener("touchcancel", () => flickKill.classList.remove("pressed"));

  const flickCtrl = document.createElement("div");
  flickCtrl.className = "quick-key quick-flick-arrow";
  flickCtrl.innerHTML = '<span class="flick-hint-top">^C</span><span class="flick-hint-left">^L</span><span class="flick-main">Ctrl</span><span class="flick-hint-right">^R</span><span class="flick-hint-bottom">^O</span>';
  let ctrlStartX = 0, ctrlStartY = 0;
  flickCtrl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    ctrlStartX = e.touches[0].clientX;
    ctrlStartY = e.touches[0].clientY;
    flickCtrl.classList.add("pressed");
  }, { passive: false });
  flickCtrl.addEventListener("touchend", (e) => {
    e.preventDefault();
    flickCtrl.classList.remove("pressed");
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
    }
  });
  flickCtrl.addEventListener("touchcancel", () => flickCtrl.classList.remove("pressed"));

  const flickTab = document.createElement("div");
  flickTab.className = "quick-key quick-flick-arrow";
  flickTab.innerHTML = '<span class="flick-hint-top">PgU</span><span class="flick-hint-left">Home</span><span class="flick-main">Tab</span><span class="flick-hint-right">End</span><span class="flick-hint-bottom">PgD</span>';
  let tabStartX = 0, tabStartY = 0;
  flickTab.addEventListener("touchstart", (e) => {
    e.preventDefault();
    tabStartX = e.touches[0].clientX;
    tabStartY = e.touches[0].clientY;
    flickTab.classList.add("pressed");
  }, { passive: false });
  flickTab.addEventListener("touchend", (e) => {
    e.preventDefault();
    flickTab.classList.remove("pressed");
    const dx = e.changedTouches[0].clientX - tabStartX;
    const dy = e.changedTouches[0].clientY - tabStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > FLICK_THRESHOLD) {
      sendKeyToTerminal(dx < 0
        ? { key: "Home", code: "Home", keyCode: 36 }
        : { key: "End", code: "End", keyCode: 35 });
    } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > FLICK_THRESHOLD) {
      sendKeyToTerminal(dy < 0
        ? { key: "PageUp", code: "PageUp", keyCode: 33 }
        : { key: "PageDown", code: "PageDown", keyCode: 34 });
    } else {
      sendKeyToTerminal({ key: "Tab", code: "Tab", keyCode: 9 });
    }
  });
  flickTab.addEventListener("touchcancel", () => flickTab.classList.remove("pressed"));
  flickTab.addEventListener("click", () => {
    sendKeyToTerminal({ key: "Tab", code: "Tab", keyCode: 9 });
  });

  const snippetAddBtn = document.createElement("div");
  snippetAddBtn.className = "quick-key quick-snippet-add-btn";
  snippetAddBtn.innerHTML = '<span class="mdi mdi-plus"></span>';
  snippetAddBtn.style.display = "none";
  const addSnippetHandler = () => {
    const cmd = prompt("コマンドを入力:");
    if (cmd) {
      addSnippet(cmd);
      renderSnippetRow();
    }
  };
  snippetAddBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  snippetAddBtn.addEventListener("touchend", (e) => { e.preventDefault(); addSnippetHandler(); });
  snippetAddBtn.addEventListener("click", addSnippetHandler);

  panel.appendChild(escBtn);
  panel.appendChild(flickKill);
  panel.appendChild(flickCtrl);
  panel.appendChild(flickTab);
  panel.appendChild(toggleBtn);
  panel.appendChild(snippetAddBtn);


  const extraPanel = document.createElement("div");
  extraPanel.className = "quick-extra-panel";
  extraPanel.style.display = "none";

  const qwertyPanel = document.createElement("div");
  qwertyPanel.className = "quick-extra-panel quick-qwerty-panel";
  qwertyPanel.style.display = "none";
  const numberRow = document.createElement("div");
  numberRow.className = "quick-extra-row quick-number-row";
  for (const keyDef of NUMBER_KEYS) numberRow.appendChild(createQuickKeyBtn(keyDef));
  qwertyPanel.appendChild(numberRow);
  let qwertyFnActive = false;
  let qwertyRow2BsBtn = null;
  const qwertyKeyBtns = [];
  for (let i = 0; i < QWERTY_ROWS.length; i++) {
    const row = document.createElement("div");
    row.className = "quick-extra-row";
    for (let j = 0; j < QWERTY_ROWS[i].length; j++) {
      const btn = createQuickKeyBtn(QWERTY_ROWS[i][j]);
      row.appendChild(btn);
      qwertyKeyBtns.push({ btn, row: i, col: j });
    }
    if (i === 2) {
      const bsBtn = createQuickKeyBtn({ label: "\u232B", key: "Backspace" });
      row.appendChild(bsBtn);
      qwertyRow2BsBtn = bsBtn;
    }
    qwertyPanel.appendChild(row);
  }
  const bottomDynBtns = [];
  const updateQwertyKeys = () => {
    for (const { btn, row, col } of qwertyKeyBtns) {
      let keyDef;
      if (qwertyFnActive) {
        keyDef = FN_ROWS[row][col];
      } else if (modifierState.shift) {
        const base = QWERTY_ROWS[row][col];
        keyDef = { ...base, label: base.key.toUpperCase() };
      } else {
        keyDef = QWERTY_ROWS[row][col];
      }
      btn._keyDef = keyDef;
      btn.textContent = keyDef.label;
    }
    for (const { btn, normal, fn } of bottomDynBtns) {
      const keyDef = qwertyFnActive ? fn : normal;
      btn._keyDef = keyDef;
      btn.textContent = keyDef.label;
    }
    if (qwertyRow2BsBtn) {
      const kd = qwertyFnActive ? { label: ">", key: ">" } : { label: "\u232B", key: "Backspace" };
      qwertyRow2BsBtn._keyDef = kd;
      qwertyRow2BsBtn.textContent = kd.label;
    }
  };
  onModifiersCleared = updateQwertyKeys;
  const fnBtn = document.createElement("div");
  fnBtn.className = "quick-key quick-modifier";
  fnBtn.textContent = "Fn";
  const toggleFn = () => {
    qwertyFnActive = !qwertyFnActive;
    fnBtn.classList.toggle("active", qwertyFnActive);
    updateQwertyKeys();
  };
  fnBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  fnBtn.addEventListener("touchend", (e) => { e.preventDefault(); toggleFn(); });
  fnBtn.addEventListener("click", toggleFn);
  const qwertyBottomRow = document.createElement("div");
  qwertyBottomRow.className = "quick-extra-row";
  const qwertyBottomDynDefs = [
    { normal: { label: "-", key: "-" }, fn: { label: "{", key: "{" } },
    { normal: { label: ".", key: "." }, fn: { label: "}", key: "}" } },
    { normal: { label: "\u2423", key: " " }, fn: { label: ",", key: "," } },
  ];
  qwertyBottomRow.appendChild(createModifierBtn("ctrl", "Ctrl"));
  qwertyBottomRow.appendChild(createModifierBtn("shift", "Shift", updateQwertyKeys));
  qwertyBottomRow.appendChild(fnBtn);
  for (const def of qwertyBottomDynDefs) {
    const btn = createQuickKeyBtn(def.normal);
    qwertyBottomRow.appendChild(btn);
    bottomDynBtns.push({ btn, normal: def.normal, fn: def.fn });
  }
  const qwertyToggle = document.createElement("div");
  qwertyToggle.className = "quick-key quick-key-toggle active";
  qwertyToggle.innerHTML = '<span class="mdi mdi-keyboard-outline"></span>';
  qwertyBottomRow.appendChild(qwertyToggle);
  const enterBtn = createQuickKeyBtn({ label: "\u21B5", key: "Enter" });
  qwertyBottomRow.appendChild(enterBtn);
  bottomDynBtns.push({ btn: enterBtn, normal: { label: "\u21B5", key: "Enter" }, fn: { label: "Esc", key: "Escape" } });
  qwertyPanel.appendChild(qwertyBottomRow);

  const snippetRow = document.createElement("div");
  snippetRow.className = "quick-snippet-row";

  function renderSnippetRow() {
    snippetRow.innerHTML = "";
    const snippets = loadSnippets();
    snippets.forEach((s, idx) => {
      const chip = document.createElement("div");
      chip.className = "quick-snippet-item";
      chip.textContent = s.label;
      let longPressTimer = null;
      let scrolled = false;
      let startX = 0;
      const SCROLL_THRESHOLD = 10;
      chip.addEventListener("touchstart", (e) => {
        scrolled = false;
        startX = e.touches[0].clientX;
        chip.classList.add("pressed");
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          chip.classList.remove("pressed");
          if (confirm(`「${s.command}」を削除しますか？`)) {
            deleteSnippet(idx);
            renderSnippetRow();
          }
        }, 600);
      }, { passive: true });
      chip.addEventListener("touchmove", (e) => {
        if (!scrolled && Math.abs(e.touches[0].clientX - startX) > SCROLL_THRESHOLD) {
          scrolled = true;
          chip.classList.remove("pressed");
          if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
        }
      }, { passive: true });
      chip.addEventListener("touchend", (e) => {
        chip.classList.remove("pressed");
        if (scrolled) return;
        if (longPressTimer !== null) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          e.preventDefault();
          sendTextToTerminal(s.command);
          extraMode = 0;
          applyMode();
        }
      });
      chip.addEventListener("touchcancel", () => {
        chip.classList.remove("pressed");
        if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
      });
      chip.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        chip.classList.add("pressed");
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          chip.classList.remove("pressed");
          if (confirm(`「${s.command}」を削除しますか？`)) {
            deleteSnippet(idx);
            renderSnippetRow();
          }
        }, 600);
      });
      chip.addEventListener("mouseup", (e) => {
        if (e.button !== 0) return;
        chip.classList.remove("pressed");
        if (longPressTimer !== null) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          sendTextToTerminal(s.command);
          extraMode = 0;
          applyMode();
        }
      });
      chip.addEventListener("mouseleave", () => {
        chip.classList.remove("pressed");
        if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
      });
      snippetRow.appendChild(chip);
    });

  }

  snippetRow.style.display = "none";

  let extraMode = 0;

  const minimalModeElements = [...minimalKeyBtns, minimalEnter];
  const mergedModeElements = [menuBtn, escBtn, flickKill, flickCtrl, flickTab];

  const addTouchBtn = (el, handler) => {
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); handler(); });
    el.addEventListener("click", handler);
  };

  const cycleMode = () => {
    extraMode = (extraMode + 1) % 3;
    qwertyFnActive = false;
    fnBtn.classList.remove("active");
    clearModifiers();
    applyMode();
  };

  const applyMode = () => {
    const active = extraMode === 1;
    toggleBtn.classList.toggle("active", active);
    panel.classList.toggle("extra-open", active);
    panel.classList.toggle("minimal-mode", extraMode === 0);
    for (const el of minimalModeElements) el.style.display = extraMode === 0 ? "" : "none";
    for (const el of mergedModeElements) el.style.display = extraMode === 1 ? "" : "none";
    extraPanel.style.display = "none";
    qwertyPanel.style.display = extraMode === 2 ? "flex" : "none";
    panel.style.display = extraMode === 2 ? "none" : "";
    toggleBtn.style.display = extraMode === 0 ? "none" : "";
    if (extraMode === 1) {
      snippetRow.style.display = "flex";
      snippetAddBtn.style.display = "";
      renderSnippetRow();
    } else {
      snippetRow.style.display = "none";
      snippetAddBtn.style.display = "none";
    }
  };
  applyMode();

  const closeExtraOnOutside = (e) => {
    if (extraMode > 1 && !e.target.closest(".quick-key-toggle") && !extraPanel.contains(e.target) && !qwertyPanel.contains(e.target) && !panel.contains(e.target) && !qwertyToggle.contains(e.target)) {
      extraMode = 0;
      applyMode();
    }
  };
  document.addEventListener("touchend", closeExtraOnOutside);
  document.addEventListener("click", closeExtraOnOutside);

  addTouchBtn(toggleBtn, cycleMode);
  addTouchBtn(qwertyToggle, cycleMode);

  const parentEl = panel.parentNode;
  parentEl.insertBefore(extraPanel, panel);
  parentEl.insertBefore(qwertyPanel, panel);
  parentEl.insertBefore(snippetRow, panel);
}
