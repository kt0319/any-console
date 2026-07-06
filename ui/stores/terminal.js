import { defineStore } from "pinia";
import { ref, reactive, markRaw } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { LS_KEY_TERMINAL_SETTINGS, LS_KEY_ACTIVE_SESSION } from "../utils/constants.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { TERMINAL_SETTINGS_META, DEFAULT_TERMINAL_SETTINGS, sanitizeTerminalSetting, sanitizeTerminalSettings } from "../utils/terminal-settings.js";
import { safeJsonLoad } from "../utils/storage.js";
import { isTouchInput } from "../utils/device.js";
import { EP_TERMINAL_ORDER, terminalSessionDetachedPath } from "../utils/endpoints.js";
import { useAuthStore } from "./auth.js";

const TERMINAL_SETTINGS_KEY = LS_KEY_TERMINAL_SETTINGS;

let _longPressActive = false;
export function setLongPressActive(v) { _longPressActive = !!v; }

function loadTerminalSettingsFromStorage() {
  return sanitizeTerminalSettings(safeJsonLoad(TERMINAL_SETTINGS_KEY, {}));
}

/**
 * @typedef {Object} TerminalTab
 * @property {number} id
 * @property {string} sessionId
 * @property {string} wsUrl
 * @property {string|null} workspace
 * @property {string} label
 * @property {{name: string, color: string|null}|null} wsIcon
 * @property {{name: string, color: string|null}|null} icon
 * @property {string|null} jobName
 * @property {string|null} jobLabel
 * @property {import("@xterm/xterm").Terminal|null} term
 * @property {import("@xterm/addon-fit").FitAddon} fitAddon
 * @property {WebSocket|null} ws
 * @property {boolean} _pendingOpen
 * @property {boolean} _pendingRedraw
 * @property {boolean} _needsHistoryRestore
 * @property {boolean} _wsDisposed
 * @property {number} _reconnectAttempts
 * @property {ReturnType<typeof setTimeout>|null} _reconnectTimer
 * @property {ReturnType<typeof setTimeout>|null} _activityTimer
 * @property {boolean} _inputBound
 * @property {boolean} _elementBound
 */

export const useTerminalStore = defineStore("terminal", () => {
  const openTabs = ref(/** @type {TerminalTab[]} */ ([]));
  const activeTabId = ref(/** @type {number|null} */ (null));
  const terminalIdCounter = ref(0);
  const hasRestoredTabsFromStorage = ref(false);
  const restoreSessionsLoading = ref(false);
  const restoreSessionsError = ref("");
  const terminalSettings = ref(loadTerminalSettingsFromStorage());
  const tabFlags = reactive({});
  // sessionId → エージェント状態（blocked/done/working/idle）。status stream WS が更新する。
  const agentStates = reactive(/** @type {Record<string, string>} */ ({}));

  /**
   * status stream WS から届いたエージェント状態をマージする。
   * @param {{ session_id: string, state: string }[]} states
   */
  function applyAgentStates(states) {
    if (!Array.isArray(states)) return;
    for (const entry of states) {
      if (entry && typeof entry.session_id === "string" && typeof entry.state === "string") {
        agentStates[entry.session_id] = entry.state;
      }
    }
  }

  function setTabFlag(tabId, key, value) {
    if (!tabFlags[tabId]) tabFlags[tabId] = {};
    tabFlags[tabId][key] = value;
  }

  function clearAgentState(sessionId) {
    if (sessionId) delete agentStates[sessionId];
  }

  function clearTabFlags(tabId) {
    delete tabFlags[tabId];
  }

  function saveTerminalSettings() {
    localStorage.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify(terminalSettings.value));
  }

  function setTerminalSetting(key, value) {
    if (!(key in DEFAULT_TERMINAL_SETTINGS)) return null;
    const next = sanitizeTerminalSetting(key, value);
    terminalSettings.value[key] = next;
    saveTerminalSettings();
    return next;
  }

  function resetTerminalSettings() {
    terminalSettings.value = { ...DEFAULT_TERMINAL_SETTINGS };
    saveTerminalSettings();
    return terminalSettings.value;
  }

  function addTerminalTab({ wsUrl, workspace, wsIcon, wsIconColor, icon, iconColor, jobName, jobLabel, restored }) {
    const opts = getTerminalRuntimeOptions();
    const term = new Terminal({ ...opts, allowProposedApi: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((e, uri) => {
      if (isTouchInput() && !_longPressActive) return;
      bridgeEmit("terminal:url", { uri });
    }));

    const sessionId = wsUrl.replace(/.*\/terminal\/ws\//, "").replace(/\?.*/, "");
    const id = ++terminalIdCounter.value;
    const label = jobLabel || workspace || "terminal";

    const tab = markRaw({
      id,
      sessionId,
      wsUrl,
      workspace: workspace || null,
      label,
      wsIcon: wsIcon ? { name: wsIcon, color: wsIconColor || null } : null,
      icon: icon ? { name: icon, color: iconColor || null } : null,
      jobName: jobName || null,
      jobLabel: jobLabel || null,
      term,
      fitAddon,
      ws: null,
      _pendingOpen: true,
      _pendingRedraw: !!restored,
      _needsHistoryRestore: !!restored,
      _wsDisposed: false,
      _reconnectAttempts: 0,
      _reconnectTimer: null,
      _activityTimer: null,
      _inputBound: false,
      _elementBound: false,
    });

    openTabs.value.push(tab);
    return tab;
  }

  function removeTab(tabId) {
    const idx = openTabs.value.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tab = openTabs.value[idx];
    if (tab.term) {
      try { tab.term.dispose(); } catch {}
      tab.term = null;
    }
    openTabs.value.splice(idx, 1);
    if (activeTabId.value === tabId) pickActiveAfter(idx);
  }

  // idx 位置以降で最初のタブ（無ければ末尾）へ active を移す。
  function pickActiveAfter(idx) {
    const tabs = openTabs.value;
    const next = tabs.find((_, i) => i >= idx) || tabs[tabs.length - 1];
    activeTabId.value = next ? next.id : null;
  }

  function switchTab(tabId) {
    activeTabId.value = tabId;
    const tab = openTabs.value.find((t) => t.id === tabId);
    if (tab) {
      localStorage.setItem(LS_KEY_ACTIVE_SESSION, tab.sessionId);
    }
  }

  function detachTab(tabId) {
    const idx = openTabs.value.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tab = openTabs.value[idx];
    if (tab.term) {
      try { tab.term.dispose(); } catch {}
      tab.term = null;
    }
    openTabs.value = openTabs.value.filter((t) => t.id !== tabId);
    if (activeTabId.value === tabId) pickActiveAfter(idx);
    if (tab.sessionId) {
      const auth = useAuthStore();
      auth.apiFetch(terminalSessionDetachedPath(tab.sessionId), {
        method: "PUT", body: { detached: true },
      }).catch(() => {});
    }
  }

  function setTabWorkspace(tabId, workspaceName) {
    const tab = openTabs.value.find((t) => t.id === tabId);
    if (!tab) return;
    tab.workspace = workspaceName || null;
    // markRaw オブジェクトの変更を Vue に検知させるため配列参照を更新
    openTabs.value = [...openTabs.value];
  }

  function moveTab(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= openTabs.value.length) return;
    if (toIndex < 0 || toIndex >= openTabs.value.length) return;
    const [tab] = openTabs.value.splice(fromIndex, 1);
    openTabs.value.splice(toIndex, 0, tab);
    saveTabOrder();
  }

  async function saveTabOrder() {
    const order = openTabs.value.map((t) => t.sessionId);
    try {
      const auth = useAuthStore();
      await auth.apiFetch(EP_TERMINAL_ORDER, { method: "PUT", body: { order } });
    } catch { /* ignore */ }
  }

  async function loadTabOrder() {
    try {
      const auth = useAuthStore();
      const res = await auth.apiFetch(EP_TERMINAL_ORDER);
      if (!res || !res.ok) return [];
      const data = await res.json().catch(() => null);
      const order = data?.order;
      return Array.isArray(order) ? order.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  }

  function getTerminalRuntimeOptions() {
    return {
      cursorBlink: terminalSettings.value.cursorBlink,
      cursorStyle: terminalSettings.value.cursorStyle,
      fontSize: terminalSettings.value.fontSize,
      fontFamily: '"Hack Nerd Font", monospace',
      scrollback: terminalSettings.value.scrollback,
      scrollOnOutput: terminalSettings.value.scrollOnOutput,
    };
  }

  return {
    openTabs,
    activeTabId,
    terminalIdCounter,
    hasRestoredTabsFromStorage,
    restoreSessionsLoading,
    restoreSessionsError,
    terminalSettings,
    tabFlags,
    agentStates,
    applyAgentStates,
    clearAgentState,
    setTabFlag,
    clearTabFlags,
    TERMINAL_SETTINGS_KEY,
    TERMINAL_SETTINGS_META,
    DEFAULT_TERMINAL_SETTINGS,
    saveTerminalSettings,
    setTerminalSetting,
    addTerminalTab,
    removeTab,
    switchTab,
    detachTab,
    moveTab,
    setTabWorkspace,
    saveTabOrder,
    loadTabOrder,
    resetTerminalSettings,
    getTerminalRuntimeOptions,
    sanitizeTerminalSetting,
    sanitizeTerminalSettings,
  };
});
