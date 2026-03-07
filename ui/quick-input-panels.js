// @ts-check
import { openTabs, activeTabId } from './state-core.js';
import { safeFit } from './utils.js';
import { NUMBER_KEYS, QWERTY_ROWS } from './state-input.js';
import { setupFlickRepeat, sendKeyToTerminal, scrollTerminal, exitViewModeIfActive, createQuickKeyBtn, modifierState, setOnModifiersCleared, setOnModifierToggled, clearModifiers, LONG_PRESS_MS } from './quick-input-keys.js';

const FLICK_THRESHOLD = 40;

/**
 * @typedef {Object} ArrowFlickContext
 * @property {() => number} getKeyboardPanelMode
 * @property {() => void} cycleMode
 * @property {() => boolean} getSnippetModeActive
 * @property {() => void} onCenterTapInSnippetMode
 */

/**
 * Creates the arrow flick key element.
 * @param {ArrowFlickContext} ctx
 * @returns {HTMLElement}
 */
export function createArrowFlickKey(ctx) {
  const el = document.createElement("div");
  el.className = "quick-key quick-flick-arrow quick-key-toggle";
  el.innerHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-keyboard"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';

  /** @param {number} dx @param {number} dy @param {number} threshold */
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

  setupFlickRepeat(el, resolveArrowKey, () => {
    if (ctx.getKeyboardPanelMode() === 1) { ctx.cycleMode(); return; }
    if (ctx.getSnippetModeActive()) { ctx.onCenterTapInSnippetMode(); return; }
    const tab = openTabs.find(t => t.id === activeTabId);
    if (tab && tab.type === "terminal" && tab.term) {
      tab.term.scrollToBottom();
      safeFit(tab);
    }
  }, {
    accelerateRepeat: true,
    onLongPress: () => ctx.cycleMode(),
    longPressGuard: () => ctx.getKeyboardPanelMode() === 0,
    onFlick: () => ctx.getSnippetModeActive(),
  });

  return el;
}

/**
 * Creates the debug/utility buttons (hard reload, clear localStorage, workspace modal).
 * @param {{ openWorkspaceModal: () => void, openCamera: () => void }} ctx
 * @returns {{ hardReloadBtn: HTMLElement, clearLocalStorageBtn: HTMLElement, workspaceModalBtn: HTMLElement }}
 */
export function createDebugButtons(ctx) {
  const hardReloadBtn = document.createElement("div");
  hardReloadBtn.className = "quick-key quick-hard-reload";
  hardReloadBtn.innerHTML = '<span class="mdi mdi-refresh"></span>';
  hardReloadBtn.style.display = "none";
  let longPressTimer = null;
  let longPressFired = false;
  hardReloadBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      longPressFired = true;
      ctx.openCamera();
    }, LONG_PRESS_MS);
  }, { passive: false });
  hardReloadBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
    if (longPressFired) return;
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
  workspaceModalBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  workspaceModalBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    ctx.openWorkspaceModal();
  });
  workspaceModalBtn.addEventListener("click", ctx.openWorkspaceModal);

  return { hardReloadBtn, clearLocalStorageBtn, workspaceModalBtn };
}

/**
 * Creates the modifier buttons (Shift, Ctrl, Space) for QWERTY mode.
 * @param {{ getUpdateQwertyKeys: () => () => void }} ctx
 * @returns {{ qwertyShiftBtn: HTMLElement, qwertyCtrlBtn: HTMLElement, qwertySpaceBtn: HTMLElement }}
 */
export function createModifierButtons(ctx) {
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
        ctx.getUpdateQwertyKeys()();
      }
    });
    qwertyShiftBtn.addEventListener("touchcancel", () => qwertyShiftBtn.classList.remove("pressed"));
    qwertyShiftBtn.addEventListener("click", () => {
      modifierState.shift = !modifierState.shift;
      qwertyShiftBtn.classList.toggle("active", modifierState.shift);
      ctx.getUpdateQwertyKeys()();
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

  return { qwertyShiftBtn, qwertyCtrlBtn, qwertySpaceBtn };
}

/**
 * Creates the Enter flick key and the scroll navigation button.
 * @param {{ getSnippetRowDisplay: () => string, closeSnippetMode: () => void, toggleSnippetRow: () => void }} ctx
 * @returns {{ minimalEnter: HTMLElement, flickNav: HTMLElement }}
 */
export function createEnterFlickKey() {
  const minimalEnter = document.createElement("div");
  minimalEnter.className = "quick-key quick-flick-enter quick-flick-arrow quick-key-toggle";
  minimalEnter.innerHTML = '<span class="flick-hint-top">Tab</span><span class="flick-hint-left">BS</span><span class="flick-main">\u21B5</span><span class="flick-hint-bottom">Space</span><span class="flick-hint-right">Del</span>';

  /** @param {number} dx @param {number} dy @param {number} threshold */
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
    exitViewModeIfActive();
    sendKeyToTerminal({ key: "Enter", code: "Enter", keyCode: 13 });
  }, {
    accelerateRepeat: true,
  });

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

  return { minimalEnter, flickNav };
}

/**
 * Creates the QWERTY keyboard panel.
 * @returns {{ qwertyPanel: HTMLElement, qwertyKeyBtns: Array<{ btn: HTMLElement, row: number, col: number }>, updateQwertyKeys: () => void }}
 */
export function createQwertyPanel(ctx = {}) {
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
    if (i === 2 && ctx.openCamera) {
      const cameraBtn = document.createElement("div");
      cameraBtn.className = "quick-key quick-flick-arrow";
      const hintTop = document.createElement("span");
      hintTop.className = "flick-hint-top";
      hintTop.innerHTML = '<span class="mdi mdi-refresh" style="font-size:10px"></span>';
      const main = document.createElement("span");
      main.className = "flick-main";
      main.innerHTML = '<span class="mdi mdi-camera"></span>';
      const hintBottom = document.createElement("span");
      hintBottom.className = "flick-hint-bottom";
      hintBottom.innerHTML = '<span class="mdi mdi-pin" style="font-size:10px"></span>';
      cameraBtn.appendChild(hintTop);
      cameraBtn.appendChild(main);
      cameraBtn.appendChild(hintBottom);
      let startY = null;
      cameraBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        startY = e.touches[0].clientY;
      }, { passive: false });
      cameraBtn.addEventListener("touchend", (e) => {
        e.preventDefault();
        const dy = startY !== null ? e.changedTouches[0].clientY - startY : 0;
        startY = null;
        if (dy < -FLICK_THRESHOLD) {
          window.location.href = window.location.pathname + "?_=" + Date.now();
        } else if (dy > FLICK_THRESHOLD) {
          if (ctx.addSnippet) ctx.addSnippet();
        } else {
          ctx.openCamera();
        }
      });
      cameraBtn.addEventListener("click", () => ctx.openCamera());
      row.appendChild(cameraBtn);
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

  setOnModifiersCleared(updateQwertyKeys);
  setOnModifierToggled(updateQwertyKeys);

  return { qwertyPanel, qwertyKeyBtns, updateQwertyKeys };
}
