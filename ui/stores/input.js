import { defineStore } from "pinia";
import { ref } from "vue";
import { LS_KEY_INPUT_HISTORY, INPUT_HISTORY_MAX } from "../utils/constants.js";
import { safeJsonLoad } from "../utils/storage.js";
import { MODIFIER_KEYS, NUMBER_KEYS as NUMBER_KEYS_DEF, QWERTY_ROWS as QWERTY_ROWS_DEF } from "../data/keyboard-layout.js";

const INPUT_HISTORY_KEY = LS_KEY_INPUT_HISTORY;

export const useInputStore = defineStore("input", () => {
  const inputHistory = ref(safeJsonLoad(INPUT_HISTORY_KEY, []));
  const snippetsCache = ref([]);
  const isSnippetsLoaded = ref(false);

  const QUICK_KEYS = ref(MODIFIER_KEYS);
  const NUMBER_KEYS = ref(NUMBER_KEYS_DEF);
  const QWERTY_ROWS = ref(QWERTY_ROWS_DEF);

  function addInputHistory(text) {
    if (!text) return;
    if (snippetsCache.value.some((s) => s.command === text)) return;
    inputHistory.value = inputHistory.value.filter((h) => h !== text);
    inputHistory.value.unshift(text);
    if (inputHistory.value.length > INPUT_HISTORY_MAX) inputHistory.value.length = INPUT_HISTORY_MAX;
    localStorage.setItem(INPUT_HISTORY_KEY, JSON.stringify(inputHistory.value));
  }

  return {
    QUICK_KEYS,
    NUMBER_KEYS,
    QWERTY_ROWS,
    INPUT_HISTORY_KEY,
    INPUT_HISTORY_MAX,
    inputHistory,
    snippetsCache,
    isSnippetsLoaded,
    addInputHistory,
  };
});
