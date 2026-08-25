import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_KEY_TERMINAL_SETTINGS } from "../utils/constants.ts";
import { TERMINAL_SETTINGS_META, DEFAULT_TERMINAL_SETTINGS, sanitizeTerminalSetting, sanitizeTerminalSettings } from "../utils/terminal-settings.ts";
import { safeJsonLoad, safeJsonSave } from "../utils/storage.ts";

/**
 * ターミナル表示設定（フォントサイズ・カーソル等）の localStorage 永続化
 * （stores/terminal.ts から分離 — タブの開閉と無関係なデバイス単位の設定）。
 */
export const useTerminalSettingsStore = defineStore("terminal-settings", () => {
  const terminalSettings = ref(
    sanitizeTerminalSettings(safeJsonLoad(LS_KEY_TERMINAL_SETTINGS, {})),
  );

  function saveTerminalSettings() {
    safeJsonSave(LS_KEY_TERMINAL_SETTINGS, terminalSettings.value);
  }

  function setTerminalSetting(key: string, value: unknown) {
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

  /** xterm の Terminal コンストラクタへ渡す実行時オプション。 */
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
    terminalSettings,
    TERMINAL_SETTINGS_META,
    DEFAULT_TERMINAL_SETTINGS,
    setTerminalSetting,
    resetTerminalSettings,
    getTerminalRuntimeOptions,
    sanitizeTerminalSetting,
    sanitizeTerminalSettings,
  };
});
