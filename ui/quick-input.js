// @ts-check
import { openTabs, activeTabId } from './state-core.js';
import { $ } from './utils.js';
import { QUICK_KEYS, EXTRA_MAIN_KEYS, addSnippet } from './state-input.js';
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

  const { qwertyPanel, qwertyKeyBtns, updateQwertyKeys } = createQwertyPanel({
    openCamera: () => { keyboardPanelMode = 0; snippetRow.style.display = "none"; applyMode(true); fileInput.click(); },
    addSnippet: async () => {
      const cmd = prompt("スニペットを追加:");
      if (cmd) {
        await addSnippet(cmd);
        renderQuickSnippets();
      }
    },
  });

  const minimalArrow = createArrowFlickKey({
    getKeyboardPanelMode: () => keyboardPanelMode,
    cycleMode: () => cycleMode(),
    getSnippetModeActive: () => false,
    onCenterTapInSnippetMode: () => {},
  });

  const { hardReloadBtn, clearLocalStorageBtn, workspaceModalBtn } = createDebugButtons({
    openWorkspaceModal: () => { openTabEditModal("open"); },
    openCamera: () => { fileInput.click(); },
  });

  const { qwertyShiftBtn, qwertyCtrlBtn, qwertySpaceBtn } = createModifierButtons({
    getUpdateQwertyKeys: () => updateQwertyKeys,
  });

  const { minimalEnter, flickNav } = createEnterFlickKey();

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

  const minimalArrowDefaultHTML = '<span class="flick-hint-top">\u2191</span><span class="flick-hint-left">\u2190</span><span class="flick-main"><span class="mdi mdi-keyboard"></span></span><span class="flick-hint-right">\u2192</span><span class="flick-hint-bottom">\u2193</span>';

  const renderQuickSnippets = () => renderSnippetRowFromKeys(snippetRow, (text) => {
    sendTextToTerminal(text);
  }).then(() => {
    scheduleAnimateVisibleModeElements();
  });

  const cycleMode = () => {
    keyboardPanelMode = (keyboardPanelMode + 1) % 2;
    clearModifiers();
    if (keyboardPanelMode === 1) {
      snippetRow.style.display = "flex";
      renderQuickSnippets();
    } else {
      snippetRow.style.display = "none";
    }
    applyMode(true);
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
      snippetRow.style.display = "none";
      applyMode();
    }
  };
  document.addEventListener("touchend", closeExtraOnOutside);
  document.addEventListener("click", closeExtraOnOutside);

  const minimalSnippetWrap = document.createElement("div");
  minimalSnippetWrap.className = "quick-minimal-snippet-wrap";
  minimalSnippetWrap.appendChild(snippetRow);

  const parentEl = panel.parentNode;
  parentEl.insertBefore(extraPanel, panel);
  parentEl.insertBefore(minimalSnippetWrap, panel);
  parentEl.insertBefore(qwertyPanel, panel);
}
