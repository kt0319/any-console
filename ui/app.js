// @ts-check
// ── Entry point ──
// Imports all modules, registers deferred event listeners,
// wires up inline-handler replacements, and boots the app.

// ── State (imported for panelBottom listener) ──
import { panelBottom, setPanelBottom, panelBottomMediaQuery, splitMode } from './state-core.js';

// ── Side-effect modules (register global listeners at import time) ──
import './logger.js';
import './terminal.js';
import './terminal-connection.js';
import './quick-input-keys.js';
import './viewport.js';

// ── Object.assign extensions (must import to register methods on GitLogModal) ──
import './git-log-graph.js';
import './git-log-history.js';
import './git-log-branch-stash.js';

// ── Modules used for wiring ──
import { openTerminalSettings } from './settings-terminal.js';
import { applyPanelBottom, exportSettings, importSettings, openSettingsServerInfo, openProcessList, openOpLog, openActivityLog } from './settings.js';
import { updateQuickInputVisibility } from './terminal-connection.js';
import { rebuildSplitLayout } from './terminal-split.js';
import { renderTabBar } from './terminal-tabs.js';

// bootstrap.js registers DOMContentLoaded which handles auth + initApp
import './bootstrap.js';

// ── panelBottomMediaQuery listener (moved from state-core.js) ──
panelBottomMediaQuery.addEventListener("change", (e) => {
  setPanelBottom(e.matches);
  applyPanelBottom();
  updateQuickInputVisibility();
  if (splitMode) rebuildSplitLayout();
  renderTabBar();
});

// ── Replace inline onclick handlers with addEventListener ──
/** @param {string} id @param {() => void} handler */
function bind(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener("click", handler);
}
bind("btn-terminal-settings", openTerminalSettings);
bind("btn-export-settings", exportSettings);
bind("btn-import-settings", importSettings);
bind("btn-process-list", openProcessList);
bind("btn-server-info", openSettingsServerInfo);
bind("btn-activity-log", openActivityLog);
bind("btn-op-log", openOpLog);

// ── Service Worker ──
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

