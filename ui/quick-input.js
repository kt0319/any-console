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

function createQuickKeyBtn(keyDef) {
  const btn = document.createElement("div");
  btn.className = "quick-key";
  if (keyDef.html) btn.innerHTML = keyDef.html;
  else btn.textContent = keyDef.label;
  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    btn.classList.add("pressed");
  }, { passive: false });
  btn.addEventListener("touchend", (e) => {
    e.preventDefault();
    btn.classList.remove("pressed");
    if (keyDef.xtermScroll) {
      scrollTerminal(keyDef.xtermScroll);
    } else {
      sendKeyToTerminal(keyDef);
    }
  });
  btn.addEventListener("touchcancel", () => btn.classList.remove("pressed"));
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
  for (let i = 0; i < QWERTY_ROWS.length; i++) {
    const row = document.createElement("div");
    row.className = "quick-extra-row";
    for (const keyDef of QWERTY_ROWS[i]) row.appendChild(createQuickKeyBtn(keyDef));
    if (i === 1) row.appendChild(createQuickKeyBtn({ label: "\u21B5", key: "Enter" }));
    qwertyPanel.appendChild(row);
  }
  const qwertyBottomRow = document.createElement("div");
  qwertyBottomRow.className = "quick-extra-row";
  const qwertyBottomKeys = [
    { label: "Tab", key: "Tab" },
    { label: "Esc", key: "Escape" },
    { label: "/", key: "/" },
    { label: "-", key: "-" },
    { label: ".", key: "." },
  ];
  for (const keyDef of qwertyBottomKeys) qwertyBottomRow.appendChild(createQuickKeyBtn(keyDef));
  const qwertyToggle = document.createElement("div");
  qwertyToggle.className = "quick-key quick-key-toggle active";
  qwertyToggle.innerHTML = '<span class="mdi mdi-keyboard-outline"></span>';
  qwertyBottomRow.appendChild(createQuickKeyBtn({ label: "@", key: "@" }));
  qwertyBottomRow.appendChild(qwertyToggle);
  qwertyBottomRow.appendChild(createQuickKeyBtn({ label: "\u2423", key: " " }));
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
      chip.addEventListener("touchstart", (e) => {
        e.preventDefault();
        chip.classList.add("pressed");
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          chip.classList.remove("pressed");
          if (confirm(`「${s.command}」を削除しますか？`)) {
            deleteSnippet(idx);
            renderSnippetRow();
          }
        }, 600);
      }, { passive: false });
      chip.addEventListener("touchend", (e) => {
        e.preventDefault();
        chip.classList.remove("pressed");
        if (longPressTimer !== null) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
          sendTextToTerminal(s.command);
          extraMode = 0;
          applyMode();
        }
      });
      chip.addEventListener("touchcancel", () => {
        chip.classList.remove("pressed");
        if (longPressTimer !== null) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
      snippetRow.appendChild(chip);
    });

    const addChip = document.createElement("div");
    addChip.className = "quick-snippet-item quick-snippet-add";
    addChip.textContent = "+";
    addChip.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    addChip.addEventListener("touchend", (e) => {
      e.preventDefault();
      const cmd = prompt("コマンドを入力:");
      if (cmd) {
        addSnippet(cmd);
        renderSnippetRow();
      }
    });
    snippetRow.appendChild(addChip);
  }

  extraPanel.insertBefore(snippetRow, extraPanel.firstChild);

  let extraMode = 0;

  const normalModeElements = [menuBtn, ...middleKeys];
  const extraModeElements = [imgBtn, ...extraKeyBtns];

  const addTouchBtn = (el, handler) => {
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); handler(); });
  };

  const cycleMode = () => {
    extraMode = (extraMode + 1) % 3;
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

  document.addEventListener("touchend", (e) => {
    if (extraMode > 0 && !e.target.closest(".quick-key-toggle") && !extraPanel.contains(e.target) && !qwertyPanel.contains(e.target) && !panel.contains(e.target) && !qwertyToggle.contains(e.target)) {
      extraMode = 0;
      applyMode();
    }
  });

  addTouchBtn(toggleBtn, cycleMode);
  addTouchBtn(qwertyToggle, cycleMode);

  const parentEl = panel.parentNode;
  parentEl.insertBefore(extraPanel, panel);
  parentEl.insertBefore(qwertyPanel, panel);
}
