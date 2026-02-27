function getActiveTerminalTab() {
  const tab = openTabs.find((t) => t.id === activeTabId);
  if (!tab || tab.type !== "terminal") return null;
  return tab;
}

function exitViewModeIfActive() {
  const tab = getActiveTerminalTab();
  if (!tab) return;
  const container = $(`frame-${tab.id}`);
  if (container && container.classList.contains("view-mode")) {
    exitTerminalViewMode(tab.id);
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
  if (e.animationName === "quick-key-bounce" || e.animationName === "snippet-bounce") {
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
    if (opts.onFlick && opts.onFlick(key, dx, dy)) { stopRepeat(); return; }
    if (repeatingKey && repeatingKey.key === key.key) return;
    stopRepeat();
    repeatingKey = key;
    sendKeyToTerminal(key);
    repeatTimer = setTimeout(() => {
      repeatTimer = setInterval(() => sendKeyToTerminal(key), REPEAT_INTERVAL);
    }, REPEAT_DELAY);
  }, { passive: true });

  el.addEventListener("touchend", (e) => {
    e.preventDefault();
    el.classList.remove("pressed");
    cancelLongPress();
    if (longPressFired) return;
    if (repeatingKey) { stopRepeat(); return; }
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const key = resolveKey(dx, dy, THRESHOLD);
    if (key) {
      if (opts.onFlick && opts.onFlick(key, dx, dy)) return;
      sendKeyToTerminal(key);
    }
    else if (onTap) onTap();
  });

  el.addEventListener("touchcancel", () => {
    el.classList.remove("pressed");
    stopRepeat();
    cancelLongPress();
  });
}

async function uploadClipboardImage(file) {
  const activeTab = openTabs.find((t) => t.id === activeTabId);
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
  } catch (e) { console.warn("uploadClipboardImage failed:", e); }
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

function createSnippetChip(text, onTap, onDelete, iconClass) {
  const chip = document.createElement("div");
  chip.className = "quick-snippet-item";
  if (iconClass) {
    const icon = document.createElement("span");
    icon.className = `mdi ${iconClass} snippet-chip-icon`;
    chip.appendChild(icon);
  }
  chip.appendChild(document.createTextNode(text.length <= 20 ? text : text.slice(0, 20) + "\u2026"));
  let longPressTimer = null;
  let longPressFired = false;
  let scrolled = false;
  let startX = 0;
  const SCROLL_THRESHOLD = 10;
  chip.addEventListener("touchstart", (e) => {
    scrolled = false;
    longPressFired = false;
    startX = e.touches[0].clientX;
    chip.classList.add("pressed");
    if (onDelete) {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
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
    if (scrolled || longPressFired) return;
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    e.preventDefault();
    chip.classList.remove("tap-bounce");
    void chip.offsetWidth;
    chip.classList.add("tap-bounce");
    onTap();
  });
  chip.addEventListener("touchcancel", () => {
    chip.classList.remove("pressed");
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  });
  chip.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    longPressFired = false;
    chip.classList.add("pressed");
    if (onDelete) {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        chip.classList.remove("pressed");
        onDelete();
      }, 600);
    }
  });
  chip.addEventListener("mouseup", (e) => {
    if (e.button !== 0) return;
    chip.classList.remove("pressed");
    if (longPressFired) return;
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    chip.classList.remove("tap-bounce");
    void chip.offsetWidth;
    chip.classList.add("tap-bounce");
    onTap();
  });
  chip.addEventListener("mouseleave", () => {
    chip.classList.remove("pressed");
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
  });
  return chip;
}

function renderSnippetRow(container, onChipTap) {
  container.innerHTML = "";
  const snippetCol = document.createElement("div");
  snippetCol.className = "quick-snippet-col";
  const historyCol = document.createElement("div");
  historyCol.className = "quick-snippet-col quick-snippet-col-right";

  const snippets = loadSnippets();
  if (snippets.length === 0) {
    const emptySnippet = document.createElement("div");
    emptySnippet.className = "quick-snippet-item quick-snippet-item-empty";
    emptySnippet.textContent = "スニペットなし";
    snippetCol.appendChild(emptySnippet);
  }

  snippets.forEach((s, idx) => {
    const chip = createSnippetChip(s.label, () => {
      onChipTap(s.command);
    }, () => {
      if (confirm(`「${s.command}」を削除しますか？`)) {
        deleteSnippet(idx);
        renderSnippetRow(container, onChipTap);
      }
    }, "mdi-pin");
    chip.classList.add("quick-history-item");
    snippetCol.appendChild(chip);
  });

  const recentHistory = inputHistory.slice(0, 5).reverse();
  if (recentHistory.length === 0) {
    const emptyHistory = document.createElement("div");
    emptyHistory.className = "quick-snippet-item quick-snippet-item-empty";
    emptyHistory.textContent = "履歴なし";
    historyCol.appendChild(emptyHistory);
  }

  recentHistory.forEach((text) => {
    const chip = createSnippetChip(text, () => {
      onChipTap(text);
    }, () => {
      setTimeout(() => {
        const cmd = prompt("スニペットを入力:", text);
        if (cmd) {
          addSnippet(cmd);
          renderSnippetRow(container, onChipTap);
        }
      }, 50);
    }, "mdi-history");
    historyCol.appendChild(chip);
  });

  container.appendChild(snippetCol);
  container.appendChild(historyCol);
}
