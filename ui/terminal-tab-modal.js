// @ts-check
import { openTabs, splitMode, splitLayout, setSplitLayout } from './state-core.js';
import { $, setupModalSwipeClose } from './utils.js';
import { switchTab, renderTabBar } from './terminal-tabs.js';
import { enterSplitMode, rebuildSplitLayout, exitSplitMode } from './terminal-split.js';
import { createTerminalTabModalWorkspaceSection } from './terminal-tab-modal-workspace.js';
import { createTabListRenderer } from './terminal-tab-modal-list.js';
import { renderTerminalSettingsPane } from './settings-terminal.js';
import { renderWorkspaceSettingsPane } from './settings-workspace.js';
import { renderProcessListTo, renderOpLogTo, renderActivityLogTo, renderServerInfoTo, exportSettings, importSettings } from './settings.js';

/**
 * Opens the tab/settings edit modal overlay.
 * @param {string} [initialTab="layout"] - The tab key to show initially.
 */
export function openTabEditModal(initialTab = "layout") {
  let overlay = document.getElementById("split-tab-modal-overlay");
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.id = "split-tab-modal-overlay";
  overlay.className = "modal-overlay";

  const modal = document.createElement("div");
  modal.className = "modal split-tab-modal";

  const header = document.createElement("div");
  header.className = "modal-header";
  const titleEl = document.createElement("h3");
  titleEl.id = "split-modal-title";
  titleEl.textContent = "ワークスペース";
  header.appendChild(titleEl);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => closeModal());
  header.appendChild(closeBtn);

  modal.appendChild(header);

  const scrollBody = document.createElement("div");
  scrollBody.className = "modal-scroll-body split-tab-scroll";
  modal.appendChild(scrollBody);

  /**
   * Sets the modal title, optionally with a back button.
   * @param {string} text
   * @param {(() => void) | null} [backFn]
   */
  function setTitle(text, backFn) {
    titleEl.textContent = "";
    titleEl.className = "";
    if (backFn) {
      titleEl.className = "split-modal-title-back";
      const arrow = document.createElement("span");
      arrow.className = "mdi mdi-arrow-left";
      titleEl.appendChild(arrow);
      titleEl.appendChild(document.createTextNode(" " + text));
      titleEl.style.cursor = "pointer";
      titleEl.onclick = backFn;
    } else {
      titleEl.textContent = text;
      titleEl.style.cursor = "";
      titleEl.onclick = null;
    }
  }

  const contentContainer = document.createElement("div");
  contentContainer.className = "split-tab-content";
  scrollBody.appendChild(contentContainer);
  const workspaceSection = createTerminalTabModalWorkspaceSection({
    contentContainer,
    switchModalTab,
    closeModal,
    setTitle,
    showMainView,
  });

  overlay.appendChild(modal);
  $("app-screen").appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  setupModalSwipeClose(overlay, closeModal);

  /** @type {HTMLButtonElement[]} */
  const modeBtns = [];

  /** Updates the split mode radio button visual state. */
  function updateModeRadio() {
    const current = splitMode ? splitLayout : "normal";
    for (const b of modeBtns) {
      b.className = "split-tab-mode-option" + (b.dataset.mode === current ? " active" : "");
    }
  }

  const tabListRenderer = createTabListRenderer({ updateModeRadio, contentContainer });
  const { renderTabList } = tabListRenderer;

  /** Shows the main settings view. */
  function showMainView() {
    contentContainer.innerHTML = "";
    setTitle("設定");
    renderSettingsTab(contentContainer);
  }

  /**
   * Switches to a named modal tab.
   * @param {string} key
   */
  function switchModalTab(key) {
    contentContainer.innerHTML = "";
    if (key === "settings") {
      showMainView();
    } else {
      renderSubPane(key);
    }
  }

  /**
   * Renders a named sub-pane inside the modal.
   * @param {string} key
   */
  function renderSubPane(key) {
    const labels = {
      "open": "ワークスペース",
      "ws-add": "新規追加",
      "ws-visibility": "ワークスペース設定",
      "layout": "タブ",
    };
    setTitle(labels[key] || key, () => switchModalTab("settings"));
    if (key === "open") renderOpenTab();
    else if (key === "ws-visibility") showPickerCloneInContainer(contentContainer, "visibility");
    else if (key === "ws-add") showPickerCloneInContainer(contentContainer, "add");
    else if (key === "layout") renderLayoutTab(contentContainer);
  }

  /**
   * Renders the layout (split mode) tab into the given target element.
   * @param {HTMLElement} target
   */
  function renderLayoutTab(target) {
    const container = target || contentContainer;
    const modeRow = document.createElement("div");
    modeRow.className = "split-tab-mode-row";
    modeBtns.length = 0;

    const modes = [
      { value: "normal", icon: "split-icon-normal", minTabs: 0 },
      { value: "vertical", icon: "split-icon-v", minTabs: 1 },
      { value: "horizontal", icon: "split-icon-h", minTabs: 1 },
      { value: "grid", icon: "split-icon-grid", minTabs: 3 },
    ];
    for (const m of modes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.mode = m.value;
      const iconEl = document.createElement("span");
      iconEl.className = m.icon;
      btn.appendChild(iconEl);
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        if (m.value === "normal") {
          if (splitMode) { exitSplitMode(); updateModeRadio(); renderTabList(); }
        } else {
          setSplitLayout(m.value);
          if (!splitMode) { enterSplitMode(); } else { rebuildSplitLayout(); }
          updateModeRadio();
          renderTabList();
        }
      });
      modeBtns.push(btn);
      modeRow.appendChild(btn);
    }

    container.appendChild(modeRow);
    updateModeRadio();

    const list = document.createElement("div");
    list.className = "modal-scroll-body split-tab-list";
    container.appendChild(list);
    renderTabList();
  }

  /** Delegates to workspaceSection to render the open-tab workspace list. */
  function renderOpenTab() {
    workspaceSection.renderOpenTab();
  }

  /**
   * Renders the settings tab into the given target element.
   * @param {HTMLElement} target
   */
  function renderSettingsTab(target) {
    const container = target || contentContainer;
    renderSettingsMenu(container);
  }

  /**
   * Renders the top-level settings menu.
   * @param {HTMLElement} target
   */
  function renderSettingsMenu(target) {
    const container = target || contentContainer;
    container.innerHTML = "";
    const menu = document.createElement("div");
    menu.className = "settings-menu";

    const items = [
      { icon: "mdi-console", label: "ワークスペース", action: () => switchModalTab("open") },
      { icon: "mdi-eye", label: "ワークスペース設定", action: () => switchModalTab("ws-visibility") },
      { icon: "mdi-plus", label: "ワークスペース追加", action: () => switchModalTab("ws-add") },
      { icon: "mdi-tab", label: "タブ", action: () => switchModalTab("layout") },
      { icon: "mdi-format-font-size-increase", label: "ターミナル", action: () => showModalSubView("ターミナル", (body) => renderTerminalSettingsPane(body, { onBack: () => switchModalTab("settings") })) },
      { icon: "mdi-download", label: "設定エクスポート", action: () => exportSettings() },
      { icon: "mdi-upload", label: "設定インポート", action: () => importSettings() },
      { icon: "mdi-format-list-bulleted", label: "プロセス一覧", action: () => showModalSubView("プロセス一覧", renderProcessListTo) },
      { icon: "mdi-information-outline", label: "サーバー情報", action: () => showModalSubView("サーバー情報", renderServerInfoTo) },
      { icon: "mdi-text-box-outline", label: "操作ログ", action: () => showModalSubView("操作ログ", renderActivityLogTo) },
      { icon: "mdi-history", label: "ネットワークログ", action: () => showModalSubView("ネットワークログ", renderOpLogTo) },
    ];

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-menu-item";
      btn.innerHTML = `<span class="mdi ${item.icon}"></span> ${item.label}`;
      btn.addEventListener("click", item.action);
      menu.appendChild(btn);
    }

    container.appendChild(menu);
  }

  /**
   * Shows a sub-view inside the modal by clearing content and calling a render function.
   * @param {string} subTitle
   * @param {(body: HTMLElement) => void} renderFn
   */
  function showModalSubView(subTitle, renderFn) {
    contentContainer.innerHTML = "";
    setTitle(subTitle, () => switchModalTab("settings"));
    const body = document.createElement("div");
    body.className = "split-tab-settings-body";
    contentContainer.appendChild(body);
    renderFn(body);
  }

  /**
   * Delegates to workspaceSection to show the picker/clone UI in the content container.
   * @param {HTMLElement} content
   * @param {string} [defaultTab="github"]
   */
  function showPickerCloneInContainer(content, defaultTab = "github") {
    workspaceSection.showPickerCloneInContainer(content, defaultTab);
  }

  /** Removes the modal overlay from the DOM. */
  function closeModal() {
    overlay.remove();
  }

  if (initialTab === "workspace") switchModalTab("open");
  else if (initialTab === "settings" || initialTab === "open") showMainView();
  else switchModalTab(initialTab);
}
