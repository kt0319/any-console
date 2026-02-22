function getTerminalTextarea() {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return null;
  const iframe = $(`frame-${activeTabId}`);
  if (!iframe) return null;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return null;
    return doc.querySelector(".xterm-helper-textarea");
  } catch {}
  return null;
}

function dispatchKeyToTerminal(keyDef) {
  const textarea = getTerminalTextarea();
  if (!textarea) return;
  const eventInit = {
    key: keyDef.key,
    code: keyDef.code || "",
    keyCode: keyDef.keyCode || 0,
    which: keyDef.keyCode || 0,
    ctrlKey: !!keyDef.ctrl,
    bubbles: true,
    cancelable: true,
  };
  textarea.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  if (keyDef.char && !keyDef.ctrl) {
    textarea.dispatchEvent(new KeyboardEvent("keypress", {
      ...eventInit,
      charCode: keyDef.char.charCodeAt(0),
    }));
  }
  textarea.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  return textarea;
}

function sendKeyToTerminal(keyDef) {
  const textarea = getTerminalTextarea();
  if (!textarea) return;
  const origFocus = textarea.focus;
  textarea.focus = () => {};
  dispatchKeyToTerminal(keyDef);
  requestAnimationFrame(() => { textarea.focus = origFocus; });
}

function sendTextToTerminal(text) {
  const textarea = getTerminalTextarea();
  if (!textarea) return;
  textarea.focus();
  textarea.value = text;
  textarea.dispatchEvent(new InputEvent("input", {
    data: text,
    inputType: "insertText",
    bubbles: true,
  }));
}

async function uploadClipboardImage(file) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return;

  console.warn("[paste] uploading image:", file.type, file.size);
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/upload-image", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) {
      console.error("[paste] upload failed:", res.status, await res.text());
      return;
    }
    const data = await res.json();
    console.warn("[paste] upload ok:", data.path);
    if (data.path) sendTextToTerminal(data.path);
  } catch (err) {
    console.error("[paste] upload error:", err);
  }
}

async function sendTmuxScroll(direction) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || activeTab.type !== "terminal") return;
  const m = activeTab.url.match(/\/terminal\/s\/([^/]+)\//);
  if (!m) return;
  const sessionId = m[1];
  try {
    await fetch(`/terminal/sessions/${sessionId}/scroll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
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
    if (keyDef.tmuxScroll) {
      sendTmuxScroll(keyDef.tmuxScroll);
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

  const openFilePicker = () => {
    fileInput.click();
  };

  const imgBtn = document.createElement("div");
  imgBtn.className = "quick-key";
  imgBtn.innerHTML = '<span class="mdi mdi-camera"></span>';
  imgBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  imgBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    openFilePicker();
  });
  imgBtn.addEventListener("click", openFilePicker);

  const menuBtn = document.createElement("div");
  menuBtn.className = "quick-key quick-key-toggle";
  menuBtn.innerHTML = '<span class="mdi mdi-menu"></span>';

  panel.appendChild(menuBtn);
  panel.appendChild(imgBtn);
  const middleKeys = quickKeyBtns.slice(0, -1);
  const enterKey = quickKeyBtns[quickKeyBtns.length - 1];

  const escKey = createQuickKeyBtn({ label: "Esc", key: "Escape", code: "Escape", keyCode: 27 });
  escKey.style.display = "none";

  for (const btn of middleKeys) panel.appendChild(btn);
  for (const btn of extraKeyBtns) panel.appendChild(btn);
  panel.appendChild(toggleBtn);
  panel.appendChild(escKey);
  panel.appendChild(enterKey);

  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.className = "quick-text-inline";
  textInput.placeholder = "テキスト入力・音声入力";
  textInput.style.display = "none";
  panel.insertBefore(textInput, toggleBtn);

  const extraPanel = document.createElement("div");
  extraPanel.className = "quick-extra-panel";
  extraPanel.style.display = "none";
  for (const [keys, cls] of [[NUMBER_KEYS, "quick-extra-row"], [EXTRA_ROW_KEYS, "quick-extra-row"]]) {
    const row = document.createElement("div");
    row.className = cls;
    for (const keyDef of keys) row.appendChild(createQuickKeyBtn(keyDef));
    extraPanel.appendChild(row);
  }

  let mode = "normal";
  let extraEnabled = false;

  const applyMode = () => {
    const isText = mode === "text";
    const isExtra = extraEnabled && !isText;
    textInput.style.display = isText ? "" : "none";
    menuBtn.style.flex = isText ? "1" : "";
    menuBtn.style.display = isExtra ? "none" : "";
    menuBtn.classList.toggle("active", isText);
    toggleBtn.style.display = isText ? "none" : "";
    toggleBtn.classList.toggle("active", extraEnabled);
    imgBtn.style.display = isExtra ? "" : "none";
    enterKey.style.display = isExtra ? "none" : isText ? "none" : "";
    escKey.style.display = isExtra ? "" : "none";
    for (const btn of middleKeys) btn.style.display = isText || isExtra ? "none" : "";
    for (const btn of extraKeyBtns) btn.style.display = isExtra ? "" : "none";
    extraPanel.style.display = extraEnabled && !isText ? "flex" : "none";
  };
  applyMode();

  const flushTextInput = () => {
    const val = textInput.value;
    if (!val) return;
    sendTextToTerminal(val);
    textInput.value = "";
  };

  const setMode = (newMode) => {
    if (newMode === "text" && mode !== "text") {
      mode = "text";
      applyMode();
      textInput.focus();
    } else if (newMode !== "text" && mode === "text") {
      flushTextInput();
      mode = newMode;
      applyMode();
    } else {
      mode = newMode;
      applyMode();
    }
  };

  let composing = false;
  textInput.addEventListener("compositionstart", () => { composing = true; });
  textInput.addEventListener("compositionend", () => { composing = false; });
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !composing) {
      flushTextInput();
      textInput.blur();
    }
  });
  textInput.addEventListener("blur", () => {
    if (composing) { textInput.focus(); return; }
    setTimeout(() => { setMode("normal"); }, 100);
  });

  const addTouchBtn = (el, handler) => {
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener("touchend", (e) => { e.preventDefault(); handler(); });
  };

  panel.addEventListener("touchend", (e) => {
    const t = e.target.closest(".quick-key");
    if (t && !t.classList.contains("quick-key-toggle")) setMode("normal");
  });
  document.addEventListener("touchend", (e) => {
    if (mode === "text" && !e.target.closest(".quick-key-toggle") && !textInput.contains(e.target)) {
      setMode("normal");
    }
    if (extraEnabled && !e.target.closest(".quick-key-toggle") && !extraPanel.contains(e.target) && !panel.contains(e.target)) {
      extraEnabled = false;
      applyMode();
    }
  });

  addTouchBtn(menuBtn, () => {
    setMode(mode === "text" ? "normal" : "text");
  });
  addTouchBtn(toggleBtn, () => {
    setMode("normal");
    extraEnabled = !extraEnabled;
    applyMode();
  });

  panel.parentNode.insertBefore(extraPanel, panel);
}
