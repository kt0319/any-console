function getActiveTerminalTab() {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab || tab.type !== "terminal") return null;
  return tab;
}

function exitViewModeIfActive() {
  const tab = getActiveTerminalTab();
  if (!tab) return;
  const container = $(`frame-${tab.id}`);
  if (container && container.classList.contains("view-mode")) {
    exitTerminalCopyMode(tab.id);
  }
}

function sendKeyToTerminal(keyDef) {
  exitViewModeIfActive();
  const tab = getActiveTerminalTab();
  if (!tab || !tab.ws || tab.ws.readyState !== WebSocket.OPEN) return;
  const seq = keyDefToAnsi(keyDef);
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

document.addEventListener("touchend", (e) => {
  const el = e.target.closest(".quick-key");
  if (!el) return;
  el.classList.remove("tap-bounce");
  void el.offsetWidth;
  el.classList.add("tap-bounce");
}, { passive: true });

document.addEventListener("animationend", (e) => {
  if (e.animationName === "quick-key-bounce") {
    e.target.classList.remove("tap-bounce");
  }
});

const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 80;

const LONG_PRESS_MS = 400;

function setupFlickRepeat(el, resolveKey, onTap, opts = {}) {
  const THRESHOLD = 40;
  let startX = 0, startY = 0;
  let repeatTimer = null;
  let repeatingKey = null;
  let longPressTimer = null;
  let longPressFired = false;

  const stopRepeat = () => {
    if (repeatTimer !== null) { clearInterval(repeatTimer); repeatTimer = null; }
    repeatingKey = null;
  };
  const cancelLongPress = () => {
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  };

  el.addEventListener("touchstart", (e) => {
    e.preventDefault();
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    el.classList.add("pressed");
    stopRepeat();
    longPressFired = false;
    if (opts.onLongPress && (!opts.longPressGuard || opts.longPressGuard())) {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        el.classList.remove("pressed");
        opts.onLongPress();
      }, LONG_PRESS_MS);
    }
  }, { passive: false });

  el.addEventListener("touchmove", (e) => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    const key = resolveKey(dx, dy, THRESHOLD);
    cancelLongPress();
    if (!key) { stopRepeat(); return; }
    if (repeatingKey && repeatingKey.key === key.key) return;
    stopRepeat();
    repeatingKey = key;
    sendKeyToTerminal(key);
    repeatTimer = setTimeout(() => {
      repeatTimer = setInterval(() => sendKeyToTerminal(key), REPEAT_INTERVAL);
    }, REPEAT_DELAY);
  });

  el.addEventListener("touchend", (e) => {
    e.preventDefault();
    el.classList.remove("pressed");
    cancelLongPress();
    if (longPressFired) return;
    if (repeatingKey) { stopRepeat(); return; }
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const key = resolveKey(dx, dy, THRESHOLD);
    if (key) sendKeyToTerminal(key);
    else if (onTap) onTap();
  });

  el.addEventListener("touchcancel", () => {
    el.classList.remove("pressed");
    stopRepeat();
    cancelLongPress();
  });
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
let onModifierToggled = null;

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
    if (btn._overrideAction) { btn._overrideAction(); return; }
    exitViewModeIfActive();
    const kd = btn._keyDef;
    if (kd.xtermScroll) {
      scrollTerminal(kd.xtermScroll);
    } else {
      const merged = { ...kd };
      if (modifierState.ctrl) merged.ctrl = true;
      if (modifierState.shift) merged.shift = true;
      sendKeyToTerminal(merged);
    }
  };
  let touchStartX = 0, touchStartY = 0;
  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    btn.classList.add("pressed");
  }, { passive: false });
  btn.addEventListener("touchend", (e) => {
    e.preventDefault();
    btn.classList.remove("pressed");
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (btn._flickUpKeyDef && dy < -30) {
      sendKeyToTerminal(btn._flickUpKeyDef);
      return;
    }
    if (btn._flickDownKeyDef && dy > 30) {
      sendKeyToTerminal(btn._flickDownKeyDef);
      return;
    }
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
    if (extraMode === 1) cycleMode();
  }, {
    onLongPress: () => cycleMode(),
    longPressGuard: () => extraMode === 0,
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
        renderSnippetRow();
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

  const flickCtrl = document.createElement("div");
  flickCtrl.className = "quick-key quick-flick-arrow quick-modifier";
  flickCtrl.innerHTML = '<span class="flick-hint-top">^C</span><span class="flick-hint-left">^L</span><span class="flick-main">\u2303</span><span class="flick-hint-right">^R</span><span class="flick-hint-bottom">^O</span>';
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
    } else {
      modifierState.ctrl = !modifierState.ctrl;
      flickCtrl.classList.toggle("active", modifierState.ctrl);
    }
  });
  flickCtrl.addEventListener("touchcancel", () => flickCtrl.classList.remove("pressed"));
  flickCtrl.addEventListener("click", () => {
    modifierState.ctrl = !modifierState.ctrl;
    flickCtrl.classList.toggle("active", modifierState.ctrl);
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
  const mode1Elements = [menuBtn, mode1Shift, flickCtrl, flickTab];
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
  let qwertyFnActive = false;
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
      if (qwertyFnActive) {
        keyDef = FN_ROWS[row][col];
      } else if (modifierState.shift) {
        const base = QWERTY_ROWS[row][col];
        keyDef = { ...base, label: base.key.toUpperCase() };
      } else {
        keyDef = QWERTY_ROWS[row][col];
      }
      btn._keyDef = keyDef;
      const fnFlickChar = qwertyFnActive ? FN_FLICK_UP[keyDef.key] : null;
      if (row === 0 && col < NUMBER_KEYS.length) {
        btn._flickUpKeyDef = fnFlickChar
          ? { label: fnFlickChar, key: fnFlickChar }
          : NUMBER_KEYS[col];
        const hintTop = btn.querySelector(".flick-hint-top");
        if (hintTop) hintTop.textContent = fnFlickChar || NUMBER_KEYS[col].label;
        const flickMain = btn.querySelector(".flick-main");
        if (flickMain) flickMain.textContent = keyDef.label;
        const hintBottom = btn.querySelector(".flick-hint-bottom");
        if (hintBottom) hintBottom.style.display = qwertyFnActive ? "none" : "";
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
      const keyDef = qwertyFnActive ? fn : normal;
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
    qwertyFnActive = !qwertyFnActive;
    fnBtn.classList.toggle("active", qwertyFnActive);
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
      const def = qwertyFnActive ? dynEntry.fn : dynEntry.normal;
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

  function createSnippetChip(text, onTap, onDelete) {
    const chip = document.createElement("div");
    chip.className = "quick-snippet-item";
    chip.textContent = text.length <= 20 ? text : text.slice(0, 20) + "\u2026";
    let longPressTimer = null;
    let scrolled = false;
    let startX = 0;
    const SCROLL_THRESHOLD = 10;
    chip.addEventListener("touchstart", (e) => {
      scrolled = false;
      startX = e.touches[0].clientX;
      chip.classList.add("pressed");
      if (onDelete) {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          chip.classList.remove("pressed");
          onDelete();
        }, 600);
      }
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
      }
      e.preventDefault();
      onTap();
    });
    chip.addEventListener("touchcancel", () => {
      chip.classList.remove("pressed");
      if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    chip.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      chip.classList.add("pressed");
      if (onDelete) {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          chip.classList.remove("pressed");
          onDelete();
        }, 600);
      }
    });
    chip.addEventListener("mouseup", (e) => {
      if (e.button !== 0) return;
      chip.classList.remove("pressed");
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      onTap();
    });
    chip.addEventListener("mouseleave", () => {
      chip.classList.remove("pressed");
      if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
    });
    return chip;
  }

  function renderSnippetRow() {
    snippetRow.innerHTML = "";
    const snippetCol = document.createElement("div");
    snippetCol.className = "quick-snippet-col";
    const historyCol = document.createElement("div");
    historyCol.className = "quick-snippet-col quick-snippet-col-right";

    const snippets = loadSnippets();
    snippets.forEach((s, idx) => {
      const chip = createSnippetChip(s.label, () => {
        sendTextToTerminal(s.command);
        closeSnippetMode();
      }, () => {
        if (confirm(`「${s.command}」を削除しますか？`)) {
          deleteSnippet(idx);
          renderSnippetRow();
        }
      });
      chip.classList.add("quick-history-item");
      snippetCol.appendChild(chip);
    });

    inputHistory.slice(0, 5).reverse().forEach((text) => {
      const chip = createSnippetChip(text, () => {
        sendTextToTerminal(text);
        closeSnippetMode();
      });
      historyCol.appendChild(chip);
    });

    snippetRow.appendChild(snippetCol);
    snippetRow.appendChild(historyCol);
  }

  snippetRow.style.display = "none";

  let extraMode = 0;

  const cycleMode = () => {
    extraMode = (extraMode + 1) % 2;
    qwertyFnActive = false;
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
      if (extraMode !== 0) {
        extraMode = 0;
        clearModifiers();
        applyMode();
      }
      snippetRow.style.display = "flex";
      renderSnippetRow();
      minimalEnter.innerHTML = '<span class="mdi mdi-close"></span>';
      minimalEnter.classList.add("active");
    }
    updateEnterBtn();
  };

  const minimalArrowDefaultHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-keyboard"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';

  const applyMode = () => {
    panel.classList.toggle("minimal-mode", extraMode === 0);
    panel.classList.toggle("extra-open", extraMode === 1);
    minimalArrow.classList.toggle("active", extraMode === 1);
    if (extraMode === 1) {
      minimalArrow.innerHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-close"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';
    } else {
      minimalArrow.innerHTML = minimalArrowDefaultHTML;
    }
    for (const el of mode1Elements) el.style.display = extraMode === 1 ? "" : "none";
    extraPanel.style.display = "none";
    qwertyPanel.style.display = extraMode === 1 ? "flex" : "none";
  };
  applyMode();

  const closeExtraOnOutside = (e) => {
    if (panel.contains(e.target) || qwertyPanel.contains(e.target) || snippetRow.contains(e.target)) return;
    if (extraMode !== 0) {
      extraMode = 0;
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
