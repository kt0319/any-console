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

  let extraPanelOpen = false;

  const normalModeElements = [menuBtn, enterKey, ...middleKeys];
  const extraModeElements = [imgBtn, ...extraKeyBtns];

  const applyMode = () => {
    toggleBtn.classList.toggle("active", extraPanelOpen);
    for (const el of normalModeElements) el.style.display = extraPanelOpen ? "none" : "";
    for (const el of extraModeElements) el.style.display = extraPanelOpen ? "" : "none";
    extraPanel.style.display = extraPanelOpen ? "flex" : "none";
  };
  applyMode();

  const addTouchBtn = (el, handler) => {
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); handler(); });
  };

  document.addEventListener("touchend", (e) => {
    if (extraPanelOpen && !e.target.closest(".quick-key-toggle") && !extraPanel.contains(e.target) && !panel.contains(e.target)) {
      extraPanelOpen = false;
      applyMode();
    }
  });

  addTouchBtn(toggleBtn, () => {
    extraPanelOpen = !extraPanelOpen;
    applyMode();
  });

  panel.parentNode.insertBefore(extraPanel, panel);
}
