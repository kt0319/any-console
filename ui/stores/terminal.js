import { defineStore } from "pinia";
import { ref, reactive, markRaw } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { LINK_TAP_RESET_MS } from "../utils/constants.js";
import { LS_KEY_TERMINAL_SETTINGS, LS_KEY_ACTIVE_SESSION } from "../utils/constants.js";
import { emit as bridgeEmit } from "../app-bridge.js";
import { TERMINAL_SETTINGS_META, DEFAULT_TERMINAL_SETTINGS, sanitizeTerminalSetting, sanitizeTerminalSettings } from "../utils/terminal-settings.js";
import { safeJsonLoad } from "../utils/storage.js";
import { EP_TERMINAL_ORDER } from "../utils/endpoints.js";
import { useAuthStore } from "./auth.js";

const TERMINAL_SETTINGS_KEY = LS_KEY_TERMINAL_SETTINGS;

let _linkTapped = false;
export function isLinkTapped() { return _linkTapped; }

let _longPressActive = false;
export function setLongPressActive(v) { _longPressActive = !!v; }
export function isLongPressActive() { return _longPressActive; }

let _isTouchEnv = false;
export function setTouchEnv(v) { _isTouchEnv = !!v; }

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
 * @property {boolean} hidden
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

  function setTabFlag(tabId, key, value) {
    if (!tabFlags[tabId]) tabFlags[tabId] = {};
    tabFlags[tabId][key] = value;
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

  function addTerminalTab({ wsUrl, workspace, wsIcon, wsIconColor, icon, iconColor, jobName, jobLabel, restored, hidden }) {
    const opts = getTerminalRuntimeOptions();
    const term = new Terminal({ ...opts, allowProposedApi: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((e, uri) => {
      if (_isTouchEnv && !_longPressActive) return;
      _linkTapped = true;
      bridgeEmit("terminal:url", { uri });
      setTimeout(() => { _linkTapped = false; }, LINK_TAP_RESET_MS);
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
      hidden: !!hidden,
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

  // idx 位置以降で最初の visible タブ（無ければ末尾の visible / null）へ active を移す。
  // タブが閉じられた・hidden 化されて active として使えなくなった時の共通再選出。
  function pickActiveAfter(idx) {
    const visibleTabs = openTabs.value.filter((t) => !t.hidden);
    const next = visibleTabs.find((t) => openTabs.value.indexOf(t) >= idx)
      || visibleTabs[visibleTabs.length - 1];
    activeTabId.value = next ? next.id : null;
  }

  function switchTab(tabId) {
    activeTabId.value = tabId;
    const tab = openTabs.value.find((t) => t.id === tabId);
    if (tab) {
      localStorage.setItem(LS_KEY_ACTIVE_SESSION, tab.sessionId);
    }
  }

  function setTabHidden(tabId, hidden) {
    // tab オブジェクトは markRaw 化されているので property の直接代入では
    // Vue の reactivity を発火しない。配列を作り直して openTabs の ref を
    // 入れ替えることで computed (TabBar の hiddenTabCount など) を再評価させる。
    const idx = openTabs.value.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tab = openTabs.value[idx];
    tab.hidden = !!hidden;
    openTabs.value = [...openTabs.value];
    // アクティブなタブを hidden にしたら、キー入力が裏の hidden タブへ送られない
    // よう次の visible タブへ active を移す。
    if (!!hidden && activeTabId.value === tabId) pickActiveAfter(idx);
    // dispatch が hidden セッションへ送らないよう backend にも反映する。
    if (tab.sessionId) {
      const auth = useAuthStore();
      auth.apiFetch(`/terminal/sessions/${encodeURIComponent(tab.sessionId)}/hidden`, {
        method: "PUT", body: { hidden: !!hidden },
      }).catch(() => { /* ignore */ });
    }
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
    setTabHidden,
    moveTab,
    saveTabOrder,
    loadTabOrder,
    resetTerminalSettings,
    getTerminalRuntimeOptions,
    sanitizeTerminalSetting,
    sanitizeTerminalSettings,
  };
});
