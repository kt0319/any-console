import { defineStore } from "pinia";
import { ref, markRaw } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { LS_KEY_TERMINAL_SETTINGS } from "../utils/constants.js";

const TERMINAL_SETTINGS_KEY = LS_KEY_TERMINAL_SETTINGS;

const TERMINAL_SETTINGS_SCHEMA = Object.freeze({
  fontSize: { type: "number", label: "Font Size", min: 10, max: 24, step: 1, unit: "px", note: "Font size in px (10-24). Applied immediately.", requiresRefit: true },
  cursorBlink: { type: "boolean", label: "Cursor Blink", note: "Blink the cursor at the input position." },
  scrollback: { type: "number", label: "Scrollback", min: 1000, max: 20000, step: 500, unit: "lines", note: "Number of lines to keep in scroll history." },
  scrollOnOutput: { type: "boolean", label: "Scroll on Output", note: "Automatically scroll to bottom on new output." },
});

const DEFAULT_TERMINAL_SETTINGS = Object.freeze({
  fontSize: 12,
  cursorBlink: true,
  scrollback: 5000,
  scrollOnOutput: true,
});

function sanitizeTerminalSetting(key, value) {
  const schema = TERMINAL_SETTINGS_SCHEMA[key];
  const fallback = DEFAULT_TERMINAL_SETTINGS[key];
  if (!schema) return fallback;
  if (schema.type === "boolean") return value === true || value === "true";
  if (schema.type === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    const rounded = schema.step && schema.step >= 1 ? Math.round(num) : num;
    return Math.min(schema.max, Math.max(schema.min, rounded));
  }
  return fallback;
}

function sanitizeTerminalSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const next = {};
  for (const key of Object.keys(DEFAULT_TERMINAL_SETTINGS)) {
    next[key] = sanitizeTerminalSetting(key, source[key]);
  }
  return next;
}

function loadTerminalSettingsFromStorage() {
  try {
    return sanitizeTerminalSettings(JSON.parse(localStorage.getItem(TERMINAL_SETTINGS_KEY) || "{}"));
  } catch {
    return sanitizeTerminalSettings({});
  }
}

export const useTerminalStore = defineStore("terminal", () => {
  const openTabs = ref([]);
  const activeTabId = ref(null);
  const terminalIdCounter = ref(0);
  const hasRestoredTabsFromStorage = ref(false);
  const restoreSessionsLoading = ref(false);
  const restoreSessionsError = ref("");
  const terminalSettings = ref(loadTerminalSettingsFromStorage());

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

  function addTerminalTab({ wsUrl, workspace, wsIcon, wsIconColor, icon, iconColor, jobName, jobLabel, initialCommand, restored, hidden }) {
    const opts = getTerminalRuntimeOptions();
    const term = new Terminal(opts);
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

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
      _initialCommand: initialCommand || null,
      _waitingInitialCommand: !!initialCommand,
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
    if (activeTabId.value === tabId) {
      const next = openTabs.value[Math.min(idx, openTabs.value.length - 1)];
      activeTabId.value = next ? next.id : null;
    }
  }

  function switchTab(tabId) {
    activeTabId.value = tabId;
  }

  function moveTab(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= openTabs.value.length) return;
    if (toIndex < 0 || toIndex >= openTabs.value.length) return;
    const [tab] = openTabs.value.splice(fromIndex, 1);
    openTabs.value.splice(toIndex, 0, tab);
  }

  function getTerminalRuntimeOptions() {
    return {
      cursorBlink: terminalSettings.value.cursorBlink,
      fontSize: terminalSettings.value.fontSize,
      fontFamily: '"Hack Nerd Font", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
      scrollback: terminalSettings.value.scrollback,
      scrollOnOutput: terminalSettings.value.scrollOnOutput,
      alternateScroll: false,
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
    TERMINAL_SETTINGS_KEY,
    TERMINAL_SETTINGS_SCHEMA,
    DEFAULT_TERMINAL_SETTINGS,
    saveTerminalSettings,
    setTerminalSetting,
    addTerminalTab,
    removeTab,
    switchTab,
    moveTab,
    resetTerminalSettings,
    getTerminalRuntimeOptions,
    sanitizeTerminalSetting,
    sanitizeTerminalSettings,
  };
});
