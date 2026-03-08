// @ts-check
import { openTabs, activeTabId, splitMode, splitPaneTabIds, panelBottom, isTouchDevice, isPageUnloading, setIsPageUnloading, isPwa } from './state-core.js';
import { $, safeFit } from './utils.js';
import { addInputHistory } from './state-input.js';

import { sendTextToTerminal } from './quick-input-keys.js';
import { renderSnippetRow } from './quick-input.js';

/** @type {boolean} */
export let prevKeyboardOpen = false;
/** @type {ReturnType<typeof setTimeout> | null} */
export let keyboardCloseTimer = null;
/** @type {number} */
export let prevViewportHeightPx = 0;

/**
 * Updates the CSS custom property `--app-dvh` to match the current visual
 * viewport height, and toggles the `keyboard-open` class on the main panel.
 * Also repositions the mobile keyboard input overlay and triggers terminal
 * re-fitting when the software keyboard closes.
 */
export function updateViewportHeight() {
  const vv = window.visualViewport;
  const viewportHeight = vv ? vv.height : window.innerHeight;
  const viewportHeightPx = Math.round(viewportHeight);
  const keyboardOpen = vv && (window.innerHeight - vv.height > 100);
  const useFullHeight = isPwa && !keyboardOpen;
  const iconPickerModal = $("icon-picker-modal");
  const iconPickerOpen = !!iconPickerModal && iconPickerModal.style.display !== "none";
  const appliedViewportHeightPx = (useFullHeight || (keyboardOpen && iconPickerOpen))
    ? Math.round(window.innerHeight)
    : viewportHeightPx;
  if (prevViewportHeightPx !== appliedViewportHeightPx) {
    prevViewportHeightPx = appliedViewportHeightPx;
    document.documentElement.style.setProperty("--app-dvh", `${appliedViewportHeightPx}px`);
  }
  document.querySelector(".main-panel").classList.toggle("keyboard-open", keyboardOpen);
  repositionKeyboardInput(keyboardOpen);
  if (prevKeyboardOpen && !keyboardOpen) {
    if (keyboardCloseTimer) clearTimeout(keyboardCloseTimer);
    keyboardCloseTimer = setTimeout(() => {
      keyboardCloseTimer = null;
      doFitActiveTerminal();
    }, 500);
  } else if (!keyboardOpen) {
    fitActiveTerminal();
  }
  prevKeyboardOpen = keyboardOpen;
}

/** @type {ReturnType<typeof setTimeout> | null} */
let fitDebounceTimer = null;

/**
 * Debounces a call to `doFitActiveTerminal` by 100 ms.
 * Does nothing while a keyboard-close timer is pending.
 */
export function fitActiveTerminal() {
  if (keyboardCloseTimer) return;
  if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
  fitDebounceTimer = setTimeout(() => {
    fitDebounceTimer = null;
    doFitActiveTerminal();
  }, 100);
}

/**
 * Immediately fits the active terminal (or all split-pane terminals) to their
 * container size and scrolls to the bottom.
 */
export function doFitActiveTerminal() {
  if (splitMode) {
    requestAnimationFrame(() => {
      for (const tabId of splitPaneTabIds) {
        const tab = openTabs.find((t) => t.id === tabId);
        if (tab && tab.type === "terminal" && tab.fitAddon) {
          safeFit(tab);
          tab.term.scrollToBottom();
        }
      }
    });
    return;
  }
  const tab = openTabs.find((t) => t.id === activeTabId);
  if (tab && tab.type === "terminal" && tab.fitAddon) {
    requestAnimationFrame(() => {
      safeFit(tab);
      tab.term.scrollToBottom();
    });
  }
}

/**
 * Creates and appends the mobile keyboard input overlay to `document.body`.
 * Returns the text `<input>` element so the caller can focus it.
 * @returns {HTMLInputElement} The created text input element.
 */
export function createMobileKeyboardInput() {
  const wrapper = document.createElement("div");
  wrapper.id = "keyboard-input-wrapper";
  wrapper.className = "keyboard-input-wrapper";

  const snippetContainer = document.createElement("div");
  snippetContainer.className = "quick-snippet-row keyboard-input-snippets";
  wrapper.appendChild(snippetContainer);

  const inputRow = document.createElement("div");
  inputRow.className = "keyboard-input-row";

  const el = document.createElement("input");
  el.type = "text";
  el.id = "keyboard-input";
  el.className = "keyboard-input";
  el.placeholder = "テキスト入力";
  el.enterKeyHint = "send";
  inputRow.appendChild(el);

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "keyboard-input-send";
  sendBtn.innerHTML = '<span class="mdi mdi-send"></span>';
  sendBtn.disabled = true;
  sendBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!el.value) return;
    const val = el.value;
    el.value = "";
    addInputHistory(val);
    sendTextToTerminal(val);
    updateBtnState();
    el.blur();
  });
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "keyboard-input-clear";
  closeBtn.innerHTML = '<span class="mdi mdi-close"></span>';
  const updateBtnState = () => {
    sendBtn.disabled = !el.value;
  };
  updateBtnState();
  el.addEventListener("input", updateBtnState);
  closeBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.value = "";
    updateBtnState();
    el.blur();
  });
  inputRow.appendChild(closeBtn);
  inputRow.appendChild(sendBtn);

  wrapper.appendChild(inputRow);

  document.body.appendChild(wrapper);

  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      const val = el.value;
      el.value = "";
      if (val) {
        addInputHistory(val);
        sendTextToTerminal(val);
      }
      updateBtnState();
      el.blur();
    }
  });
  el.addEventListener("blur", () => {
    setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) {
        wrapper.style.display = "none";
      }
    }, 150);
  });

  return el;
}

/**
 * Re-renders the snippet row inside the keyboard input wrapper using the
 * current snippet data, binding each snippet to populate the input field.
 */
export function renderKeyboardSnippets() {
  const wrapper = document.getElementById("keyboard-input-wrapper");
  if (!wrapper) return;
  const container = wrapper.querySelector(".keyboard-input-snippets");
  const input = wrapper.querySelector(".keyboard-input");
  if (!container || !input) return;
  void renderSnippetRow(container, (text) => {
    input.value = text;
    input.dispatchEvent(new Event("input"));
    input.focus({ preventScroll: true });
  });
}

/**
 * Shows the mobile keyboard input overlay.
 * Creates the overlay DOM if it does not yet exist.
 * Does nothing when a terminal view-mode frame is active.
 */
export function showKeyboardInput() {
  if (document.querySelector(".terminal-frame.view-mode")) return;
  let el = $("keyboard-input");
  if (!el) el = createMobileKeyboardInput();
  el.value = "";
  el.dispatchEvent(new Event("input"));
  const wrapper = el.closest(".keyboard-input-wrapper");
  wrapper.style.display = "";
  wrapper.style.top = "";
  renderKeyboardSnippets();
  const vv = window.visualViewport;
  if (vv) {
    const bottomOffset = window.innerHeight - (vv.offsetTop + vv.height);
    wrapper.style.bottom = (bottomOffset + 8) + "px";
  }
  el.focus({ preventScroll: true });
}

/**
 * Repositions the keyboard input overlay to sit just above the software
 * keyboard, or hides it when the keyboard is not open.
 * @param {boolean} keyboardOpen Whether the software keyboard is currently visible.
 */
export function repositionKeyboardInput(keyboardOpen) {
  const el = $("keyboard-input");
  if (!el) return;
  const wrapper = el.closest(".keyboard-input-wrapper");
  if (!wrapper || wrapper.style.display === "none") return;
  if (keyboardOpen) {
    const vv = window.visualViewport;
    if (vv) {
      const bottomOffset = window.innerHeight - (vv.offsetTop + vv.height);
      wrapper.style.bottom = (bottomOffset + 8) + "px";
    }
  } else {
    wrapper.style.display = "none";
  }
}

window.addEventListener("beforeunload", () => {
  setIsPageUnloading(true);
});

document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
document.addEventListener("touchmove", (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
let lastTouchEnd = 0;
document.addEventListener("touchend", (e) => {
  if (e.target.closest(".modal-overlay")) return;
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });
