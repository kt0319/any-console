import { defineStore } from "pinia";
import { ref } from "vue";

const TERMINAL_SETTINGS_KEY = "pi_console_terminal_settings";

const TERMINAL_SETTINGS_SCHEMA = Object.freeze({
  fontSize: { type: "number", label: "フォントサイズ", min: 10, max: 24, step: 1, unit: "px", note: "文字サイズ。10〜24px、レイアウトへ即時反映されます。", requiresRefit: true },
  cursorBlink: { type: "boolean", label: "カーソル点滅", note: "入力位置のカーソルを点滅表示します。" },
  scrollback: { type: "number", label: "スクロールバック", min: 1000, max: 20000, step: 500, unit: "行", note: "保持する過去出力の行数です。" },
  scrollOnOutput: { type: "boolean", label: "出力時スクロール", note: "新しい出力が来たとき末尾へ追従します。" },
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
  const orphanSessions = ref([]);
  const closedSessionUrls = ref(new Set());
  const isPageUnloading = ref(false);
  const hasRestoredTabsFromStorage = ref(false);
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
    orphanSessions,
    closedSessionUrls,
    isPageUnloading,
    hasRestoredTabsFromStorage,
    terminalSettings,
    TERMINAL_SETTINGS_KEY,
    TERMINAL_SETTINGS_SCHEMA,
    DEFAULT_TERMINAL_SETTINGS,
    saveTerminalSettings,
    setTerminalSetting,
    resetTerminalSettings,
    getTerminalRuntimeOptions,
    sanitizeTerminalSetting,
    sanitizeTerminalSettings,
  };
});
