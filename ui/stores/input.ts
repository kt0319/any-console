import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_KEY_INPUT_HISTORY, INPUT_HISTORY_MAX } from "../utils/constants.ts";
import { safeJsonLoad, safeJsonSave } from "../utils/storage.ts";
import { NUMBER_KEYS as NUMBER_KEYS_DEF, QWERTY_ROWS as QWERTY_ROWS_DEF } from "../data/keyboard-layout.ts";

const INPUT_HISTORY_KEY = LS_KEY_INPUT_HISTORY;

export const useInputStore = defineStore("input", () => {
  const inputHistory = ref<string[]>(safeJsonLoad(INPUT_HISTORY_KEY, []));
  const snippetsCache = ref<{ label: string, command: string }[]>([]);
  const isSnippetsLoaded = ref(false);

  const NUMBER_KEYS = ref(NUMBER_KEYS_DEF);
  const QWERTY_ROWS = ref(QWERTY_ROWS_DEF);

  function addInputHistory(text: string) {
    if (!text) return;
    if (snippetsCache.value.some((s) => s.command === text)) return;
    inputHistory.value = inputHistory.value.filter((h) => h !== text);
    inputHistory.value.unshift(text);
    if (inputHistory.value.length > INPUT_HISTORY_MAX) inputHistory.value.length = INPUT_HISTORY_MAX;
    safeJsonSave(INPUT_HISTORY_KEY, inputHistory.value);
  }

  function removeInputHistory(text: string) {
    inputHistory.value = inputHistory.value.filter((h) => h !== text);
    safeJsonSave(INPUT_HISTORY_KEY, inputHistory.value);
  }

  return {
    NUMBER_KEYS,
    QWERTY_ROWS,
    INPUT_HISTORY_MAX,
    inputHistory,
    snippetsCache,
    isSnippetsLoaded,
    addInputHistory,
    removeInputHistory,
  };
});
