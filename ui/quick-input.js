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

  panel.appendChild(menuBtn);
  panel.appendChild(imgBtn);
  const middleKeys = quickKeyBtns.slice(0, -1);
  const enterKey = quickKeyBtns[quickKeyBtns.length - 1];

  for (const btn of middleKeys) panel.appendChild(btn);
  for (const btn of extraKeyBtns) panel.appendChild(btn);
  panel.appendChild(toggleBtn);
  panel.appendChild(enterKey);

  const extraPanel = document.createElement("div");
  extraPanel.className = "quick-extra-panel";
  extraPanel.style.display = "none";
  const escKey = createQuickKeyBtn({ label: "Esc", key: "Escape", code: "Escape", keyCode: 27 });
  for (const [keys, cls] of [[NUMBER_KEYS, "quick-extra-row"], [EXTRA_ROW_KEYS, "quick-extra-row"]]) {
    const row = document.createElement("div");
    row.className = cls;
    for (const keyDef of keys) row.appendChild(createQuickKeyBtn(keyDef));
    if (cls === "quick-extra-row" && keys === EXTRA_ROW_KEYS) row.appendChild(escKey);
    extraPanel.appendChild(row);
  }

  const qwertyPanel = document.createElement("div");
  qwertyPanel.className = "quick-extra-panel quick-qwerty-panel";
  qwertyPanel.style.display = "none";
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
      const startPress = () => {
        chip.classList.add("pressed");
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          chip.classList.remove("pressed");
          if (confirm(`「${s.command}」を削除しますか？`)) {
            deleteSnippet(idx);
            renderSnippetRow();
          }
        }, 600);
      };
      const endPress = () => {
        chip.classList.remove("pressed");
        if (longPressTimer !== null) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          sendTextToTerminal(s.command);
          extraMode = 0;
          applyMode();
        }
      };
      const cancelPress = () => {
        chip.classList.remove("pressed");
        if (longPressTimer !== null) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };
      chip.addEventListener("touchstart", (e) => { e.preventDefault(); startPress(); }, { passive: false });
      chip.addEventListener("touchend", (e) => { e.preventDefault(); endPress(); });
      chip.addEventListener("touchcancel", cancelPress);
      chip.addEventListener("mousedown", (e) => { if (e.button === 0) startPress(); });
      chip.addEventListener("mouseup", (e) => { if (e.button === 0) endPress(); });
      chip.addEventListener("mouseleave", cancelPress);
      snippetRow.appendChild(chip);
    });

    const addChip = document.createElement("div");
    addChip.className = "quick-snippet-item quick-snippet-add";
    addChip.textContent = "+";
    const addSnippetHandler = () => {
      const cmd = prompt("コマンドを入力:");
      if (cmd) {
        addSnippet(cmd);
        renderSnippetRow();
      }
    };
    addChip.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    addChip.addEventListener("touchend", (e) => { e.preventDefault(); addSnippetHandler(); });
    addChip.addEventListener("click", addSnippetHandler);
    snippetRow.appendChild(addChip);
  }

  extraPanel.insertBefore(snippetRow, extraPanel.firstChild);

  let extraMode = 0;

  const normalModeElements = [menuBtn, ...middleKeys];
  const extraModeElements = [imgBtn, ...extraKeyBtns];

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
    const active = extraMode > 0;
    toggleBtn.classList.toggle("active", active);
    panel.classList.toggle("extra-open", active);
    for (const el of normalModeElements) el.style.display = extraMode === 0 ? "" : "none";
    for (const el of extraModeElements) el.style.display = extraMode === 1 ? "" : "none";
    extraPanel.style.display = extraMode === 1 ? "flex" : "none";
    qwertyPanel.style.display = extraMode === 2 ? "flex" : "none";
    panel.style.display = extraMode === 2 ? "none" : "";
    if (extraMode === 1) renderSnippetRow();
  };
  applyMode();

  const closeExtraOnOutside = (e) => {
    if (extraMode > 0 && !e.target.closest(".quick-key-toggle") && !extraPanel.contains(e.target) && !qwertyPanel.contains(e.target) && !panel.contains(e.target) && !qwertyToggle.contains(e.target)) {
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
}
