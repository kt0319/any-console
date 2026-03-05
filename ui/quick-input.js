// @ts-check
import { openTabs, activeTabId } from './state-core.js';
import { $ } from './utils.js';
import { QUICK_KEYS, EXTRA_MAIN_KEYS } from './state-input.js';
import { sendTextToTerminal, createQuickKeyBtn, renderSnippetRow as renderSnippetRowFromKeys, clearModifiers, uploadClipboardImage } from './quick-input-keys.js';
import { openTabEditModal } from './terminal-tab-modal.js';
import { createArrowFlickKey, createDebugButtons, createModifierButtons, createEnterFlickKey, createQwertyPanel } from './quick-input-panels.js';

// Re-export renderSnippetRow so viewport.js can import it from this module.
export { renderSnippetRowFromKeys as renderSnippetRow };

/**
 * Initialises the quick-input panel: creates all buttons, sets up flick
 * gestures, snippet row, QWERTY overlay, and appends everything to the DOM.
 * @returns {void}
 */
export function initQuickInput() {
  const panel = $("quick-input-panel");

  let snippetModeActive = false;
  let keyboardPanelMode = 0;

  const snippetRow = document.createElement("div");
  snippetRow.className = "quick-snippet-row";
  snippetRow.style.display = "none";

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

  const { qwertyPanel, qwertyKeyBtns, updateQwertyKeys } = createQwertyPanel();

  const minimalArrow = createArrowFlickKey({
    getKeyboardPanelMode: () => keyboardPanelMode,
    cycleMode: () => cycleMode(),
    getSnippetModeActive: () => snippetModeActive,
    onCenterTapInSnippetMode: () => { closeSnippetMode(); fileInput.click(); },
  });

  const { hardReloadBtn, clearLocalStorageBtn, workspaceModalBtn } = createDebugButtons({
    openWorkspaceModal: () => {
      closeSnippetMode();
      openTabEditModal("open");
    },
  });

  const snippetExtras = [workspaceModalBtn, clearLocalStorageBtn, hardReloadBtn];

  const { qwertyShiftBtn, qwertyCtrlBtn, qwertySpaceBtn } = createModifierButtons({
    getUpdateQwertyKeys: () => updateQwertyKeys,
  });

  const { minimalEnter, flickNav } = createEnterFlickKey({
    getSnippetRowDisplay: () => snippetRow.style.display,
    closeSnippetMode: () => closeSnippetMode(),
    toggleSnippetRow: () => toggleSnippetRow(),
  });

  /**
   * @param {Element[]} elements
   */
  const animateElements = (elements) => {
    for (const el of elements) {
      if (!el || el.offsetParent === null) continue;
      el.classList.remove("tap-bounce");
      void el.offsetWidth;
      el.classList.add("tap-bounce");
    }
  };
  /** @returns {Element[]} */
  const collectVisibleModeElements = () => [
    ...panel.querySelectorAll(".quick-key"),
    ...qwertyPanel.querySelectorAll(".quick-key"),
    ...snippetRow.querySelectorAll(".quick-key"),
    ...snippetRow.querySelectorAll(".quick-snippet-item"),
  ];
  const scheduleAnimateVisibleModeElements = () => {
    requestAnimationFrame(() => {
      animateElements(collectVisibleModeElements());
    });
  };

  const qwertyModKeys = [qwertyShiftBtn, qwertyCtrlBtn, qwertySpaceBtn];
  for (const el of qwertyModKeys) el.style.display = "none";
  const minimalKeyBtns = [workspaceModalBtn, clearLocalStorageBtn, hardReloadBtn, ...qwertyModKeys, minimalArrow];
  const quickKeyBtns = QUICK_KEYS.map(k => createQuickKeyBtn(k));
  const extraKeyBtns = EXTRA_MAIN_KEYS.map(k => {
    const btn = createQuickKeyBtn(k);
    btn.style.display = "none";
    return btn;
  });

  const enterBtn = createQuickKeyBtn({ label: "\u21B5", key: "Enter" });

  const updateEnterBtn = () => {
    const snippetVisible = snippetRow.style.display === "flex";
    if (snippetVisible) {
      enterBtn.innerHTML = '<span class="mdi mdi-close"></span>';
      enterBtn._overrideAction = () => { snippetRow.style.display = "none"; updateEnterBtn(); };
    } else {
      enterBtn._overrideAction = null;
      enterBtn._keyDef = { label: "\u21B5", key: "Enter" };
      enterBtn.textContent = "\u21B5";
    }
  };

  const minimalEnterDefaultHTML = '<span class="flick-hint-top">Tab</span><span class="flick-hint-left">BS</span><span class="flick-main">\u21B5</span><span class="flick-hint-bottom">Space</span><span class="flick-hint-right">Del</span>';
  const minimalArrowDefaultHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-keyboard"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';

  function closeSnippetMode() {
    snippetModeActive = false;
    snippetRow.style.display = "none";
    for (const el of snippetExtras) el.style.display = "none";
    panel.classList.remove("snippet-open");
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    minimalArrow.innerHTML = minimalArrowDefaultHTML;
    updateEnterBtn();
    scheduleAnimateVisibleModeElements();
  }

  const renderQuickSnippets = () => renderSnippetRowFromKeys(snippetRow, (text) => {
    sendTextToTerminal(text);
    closeSnippetMode();
  }).then(() => {
    scheduleAnimateVisibleModeElements();
  });

  const cycleMode = () => {
    keyboardPanelMode = (keyboardPanelMode + 1) % 2;
    clearModifiers();
    snippetModeActive = false;
    snippetRow.style.display = "none";
    for (const el of snippetExtras) el.style.display = "none";
    panel.classList.remove("snippet-open");
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    updateEnterBtn();
    applyMode(true);
  };

  const toggleSnippetRow = () => {
    const visible = snippetRow.style.display === "flex";
    if (visible) {
      snippetModeActive = false;
      snippetRow.style.display = "none";
      for (const el of snippetExtras) el.style.display = "none";
      panel.classList.remove("snippet-open");
      minimalEnter.innerHTML = minimalEnterDefaultHTML;
      minimalEnter.classList.remove("active");
      minimalArrow.innerHTML = minimalArrowDefaultHTML;
      scheduleAnimateVisibleModeElements();
    } else {
      if (keyboardPanelMode !== 0) {
        keyboardPanelMode = 0;
        clearModifiers();
        applyMode();
      }
      snippetModeActive = true;
      snippetRow.style.display = "flex";
      for (const el of snippetExtras) el.style.display = "";
      panel.classList.add("snippet-open");
      renderQuickSnippets();
      minimalEnter.innerHTML = '<span class="mdi mdi-close"></span>';
      minimalEnter.classList.add("active");
      minimalArrow.innerHTML = '<span class="flick-main"><span class="mdi mdi-camera"></span></span>';
      scheduleAnimateVisibleModeElements();
    }
    updateEnterBtn();
  };

  /**
   * @param {boolean} [animate=false]
   */
  const applyMode = (animate = false) => {
    panel.classList.toggle("minimal-mode", keyboardPanelMode === 0);
    panel.classList.toggle("extra-open", keyboardPanelMode === 1);
    minimalArrow.classList.toggle("active", keyboardPanelMode === 1);
    if (keyboardPanelMode === 1) {
      minimalArrow.innerHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-close"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';
    } else {
      minimalArrow.innerHTML = minimalArrowDefaultHTML;
    }
    for (const el of qwertyModKeys) el.style.display = keyboardPanelMode === 1 ? "" : "none";
    extraPanel.style.display = "none";
    qwertyPanel.style.display = keyboardPanelMode === 1 ? "flex" : "none";
    if (animate) scheduleAnimateVisibleModeElements();
  };

  for (const btn of minimalKeyBtns) panel.appendChild(btn);
  panel.appendChild(minimalEnter);

  const extraPanel = document.createElement("div");
  extraPanel.className = "quick-extra-panel";
  extraPanel.style.display = "none";

  applyMode();

  const closeExtraOnOutside = (e) => {
    if (panel.contains(e.target) || qwertyPanel.contains(e.target) || snippetRow.contains(e.target)) return;
    if (keyboardPanelMode !== 0) {
      keyboardPanelMode = 0;
      applyMode();
    }
    snippetModeActive = false;
    snippetRow.style.display = "none";
    for (const el of snippetExtras) el.style.display = "none";
    panel.classList.remove("snippet-open");
    minimalEnter.innerHTML = minimalEnterDefaultHTML;
    minimalEnter.classList.remove("active");
    minimalArrow.innerHTML = minimalArrowDefaultHTML;
    updateEnterBtn();
  };
  document.addEventListener("touchend", closeExtraOnOutside);
  document.addEventListener("click", closeExtraOnOutside);

  const minimalSnippetWrap = document.createElement("div");
  minimalSnippetWrap.className = "quick-minimal-snippet-wrap";
  minimalSnippetWrap.appendChild(snippetRow);

  const parentEl = panel.parentNode;
  parentEl.insertBefore(extraPanel, panel);
  parentEl.insertBefore(qwertyPanel, panel);
  parentEl.insertBefore(minimalSnippetWrap, panel);
}
