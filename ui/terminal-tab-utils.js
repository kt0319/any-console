// @ts-check
import { splitMode, splitPaneTabIds, activeTabId, openTabs } from './state-core.js';
import { renderIcon } from './utils.js';

/**
 * Returns the display name for a tab.
 * @param {any} tab
 * @returns {string}
 */
export function tabDisplayName(tab) {
  if (!tab) return "";
  return tab.workspace || tab.label || "";
}

/**
 * Returns the HTML string for a tab's icon(s).
 * @param {any} tab
 * @param {number} [size]
 * @returns {string}
 */
export function renderTabIconHtml(tab, size = 14) {
  return (tab.wsIcon ? renderIcon(tab.wsIcon.name, tab.wsIcon.color, size) : "")
       + (tab.icon ? renderIcon(tab.icon.name, tab.icon.color, size) : "");
}

/**
 * Resolves the workspace name for a given tab object.
 * @param {any} tab
 * @returns {string|null}
 */
export function resolveWorkspaceNameForTab(tab) {
  if (!tab) return null;
  if (tab.workspace) return tab.workspace;
  if (tab.type === "terminal" && tab.label && tab.label !== "terminal") return tab.label;
  return null;
}

/**
 * Returns true if there is visible tab content in the current layout.
 * @returns {boolean}
 */
export function hasVisibleTabContent() {
  if (splitMode) {
    return splitPaneTabIds.some((id) => openTabs.some((t) => t.id === id));
  }
  return openTabs.some((t) => t.id === activeTabId);
}
